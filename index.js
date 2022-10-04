import { makeRoutedFetch } from 'make-fetch'
import { IPLDURLSystem } from 'js-ipld-url-resolve'

import parseRange from 'range-parser'
import mime from 'mime/lite.js'

import { exporter } from 'ipfs-unixfs-exporter'
import { CID } from 'multiformats/cid'

import { base32 } from 'multiformats/bases/base32'
import { base36 } from 'multiformats/bases/base36'

// Different from raw JSON. Determenistic
import * as dagJSON from '@ipld/dag-json'
import * as cbor from '@ipld/dag-cbor'

import crypto from 'crypto'
import { posix as posixPath } from 'path'

import { EventIterator } from 'event-iterator'

const bases = base32.decoder.or(base36.decoder)

const IPFS_TIMEOUT = 30000
const IPNS_TIMEOUT = 120000
const SPECIAL_HOSTNAME = 'localhost'

const DEFAULT_HEADERS = {
  'Content-Type': 'text/plain; charset=utf-8'
}

async function DEFAULT_ON_NOT_FOUND (request) {
  console.log(request)
  return {
    status: 405,
    body: 'Method Not Supported'
  }
}

async function DEFAULT_RENDER_INDEX (url, files, fetch) {
  return `
<!DOCTYPE html>
<title>Index of ${url.pathname}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<h1>Index of ${url.pathname}</h1>
<ul>
  <li><a href="../">../</a></li>
  ${files.map((file) => `<li><a href="${file}">./${file}</a></li>`).join('\n')}
</ul>
`
}

export default function makeIPFSFetch ({
  ipfs,
  timeout = IPFS_TIMEOUT,
  ipnsTimeout = IPNS_TIMEOUT,
  onNotFound = DEFAULT_ON_NOT_FOUND,
  renderIndex = DEFAULT_RENDER_INDEX,
  defaultHeaders = DEFAULT_HEADERS,
  writable = true
}) {
  const { router, fetch } = makeRoutedFetch({
    onNotFound
  })
  const ipldSystem = new IPLDURLSystem({
    getNode
  })

  router.get('ipld://*/**', async ({ url, headers, signal }) => {
    const accept = headers.get('Accept')
    const format = new URL(url).searchParams.get('format')

    const value = ipldSystem.resolve(url.href)

    if (format === 'dag-cbor' || accept === 'application/vnd.ipld.dag-cbor') {
      return {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.ipld.dag-cbor'
        },
        body: cbor.encode(value)
      }
    }

    return {
      status: 200,
      headers: {
        'Content-Type': 'appliction/json'
      },
      body: dagJSON.encode(value)
    }
  })

  if (writable) {
    router.post(`ipld://${SPECIAL_HOSTNAME}/**`, async (request) => {
      const { headers, url, signal } = request
      const contentType = headers.get('Content-Type')
      const format = new URL(url).searchParams.get('format')

      const data = await request.arrayBuffer()

      let decoded = null
      let storeCodec = cbor

      if (contentType === 'application/json') {
        decoded = JSON.parse(data.toString('utf8'))
        storeCodec = 'dag-json'
      } else if (contentType === 'application/dag-json') {
        decoded = dagJSON.decode(data)
        storeCodec = 'dag-json'
      } else if (contentType === 'application/vnd.ipld.dag-cbor') {
        decoded = cbor.decode(data)
        storeCodec = 'dag-cbor'
      } else {
        return {
          // TODO: better status?
          status: 400,
          headers: defaultHeaders,
          body: 'Unsupproted content-type, must be dag-cbor, or dag-json'
        }
      }

      if (format) {
        if (format === 'dag-json' || format === 'dag-cbor') {
          storeCodec = format
        } else {
          return {
          // TODO: better status?
            status: 400,
            headers: defaultHeaders,
            body: 'Unsupproted format, must be dag-json or dag-cbor'
          }
        }
      }

      const cid = await ipfs.dag.put(decoded, {
        storeCodec,
        timeout,
        signal
      })

      const cidHash = cid.toV1().toString()
      const addedURL = `ipld://${cidHash}/`

      headers.Location = addedURL

      return {
        status: 201,
        headers: {
          ...defaultHeaders,
          Location: addedURL
        },
        body: addedURL
      }
    })
  }

  if (writable) {
    router.get('pubsub://*/', async ({ url, headers }) => {
      const format = new URL(url).searchParams.get('format')
      const accept = headers.get('Accept')
      const topic = url.hostname

      if (accept && accept.includes('text/event-stream')) {
        const events = new EventIterator(({ push, fail }) => {
          function handler ({ from, data, topicIDs: topics, seqno }) {
            try {
              const id = Buffer.from(seqno).toString('hex')
              let formatted = null
              if (format === 'json') {
                formatted = JSON.parse(Buffer.from(data).toString('utf8'))
              } else if (format === 'utf8') {
                formatted = Buffer.from(data).toString('utf8')
              } else {
                formatted = Buffer.from(data).toString('base64')
              }

              const eventData = JSON.stringify({
                from,
                topics,
                data: formatted
              })

              push(`id:${id}\ndata:${eventData}\n\n`)
            } catch (e) {
              push(`type:error\ndata:${e.stack}\n\n`)
            }
          }
          ipfs.pubsub.subscribe(topic, handler).catch((e) => {
            fail(e)
          })
          return () => ipfs.pubsub.unsubscribe(topic, handler)
        })

        return {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream'
          },
          body: events
        }
      }

      const id = await ipfs.id()
      const subs = await ipfs.pubsub.ls()
      const subscribed = subs.includes(topic)

      const body = JSON.stringify({ id, topic, subscribed }, null, '\t')

      return {
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        },
        body
      }
    })

    router.post('pubsub://*/', async (request) => {
      const { url, signal } = request
      const topic = url.hostname
      const payload = await request.arrayBuffer()
      // TODO: Handle oversized messages wihth 413
      await ipfs.pubsub.publish(topic, payload, {
        signal,
        timeout
      })

      return {
        status: 200
      }
    })
  }

  if (writable) {
    router.get(`ipns://${SPECIAL_HOSTNAME}/`, async ({ url, signal }) => {
      const key = new URL(url).searchParams.get('key')
      const exists = await hasKey(key, signal)
      if (!exists) {
        return {
          status: 404,
          headers: defaultHeaders,
          body: 'Key Not Found'
        }
      } else {
        const keyURL = keyToURL(exists)
        return {
          status: 302,
          headers: {
            ...defaultHeaders,
            Location: keyURL
          },
          body: keyURL
        }
      }
    })
    // TODO: Generate from headers somehow
    router.post(`ipns://${SPECIAL_HOSTNAME}/`, async ({ url, signal }) => {
      const key = new URL(url).searchParams.get('key')
      // Localhost is used for generating keys
      const exists = await hasKey(key, signal)
      if (!exists) {
        await genKey(key, signal)
      }
      const keyData = await hasKey(key, signal)
      const keyURL = keyToURL(keyData)

      return {
        status: 201,
        headers: {
          Location: keyURL
        }
      }
    })
    router.delete(`ipns://${SPECIAL_HOSTNAME}/`, async ({ url, signal }) => {
      const key = new URL(url).searchParams.get('key')
      await ipfs.key.rm(key, {
        signal,
        timeout
      })

      return {
        status: 200
      }
    })

    router.post(`ipfs://${SPECIAL_HOSTNAME}/`, async (request) => {
      const { headers, signal } = request
      const contentType = headers.get('Content-Type') || ''
      const isFormData = contentType.includes('multipart/form-data')
      const isCAR = contentType.includes('application/vnd.ipld.car')

      if (isCAR) {
        const results = []
        const importOpts = { timeout, pinRoots: true }
        for await (const { root } of ipfs.dag.import(request.body, importOpts)) {
          const { cid } = root

          const cidHash = cid.toString()
          const addedURL = `ipfs://${cidHash}/`

          results.push(addedURL)
        }

        return {
          status: 200,
          headers: defaultHeaders,
          body: results.join('\n')
        }
      }

      const dir = '/ipfs/bafyaabakaieac/localhost'
      const addedURLRaw = await uploadData(dir, request, isFormData, signal)
      // Resolve the localhost thing back to the root CID
      const { cid } = await ipfs.dag.resolve(addedURLRaw.replace('ipfs://', '/ipfs/'))

      const cidHash = cid.toString()
      const addedURL = `ipfs://${cidHash}/`

      return {
        status: 201,
        headers: {
          ...defaultHeaders,
          Location: addedURL
        },
        body: addedURL
      }
    })

    router.put(`ipfs://${SPECIAL_HOSTNAME}/`, onNotFound)
    router.put('ipfs://*/**', async (request) => {
      const { url, headers, signal } = request
      const contentType = headers.get('Content-Type') || ''
      const isFormData = contentType.includes('multipart/form-data')

      const ipfsPath = urlToIPFSPath(url)

      const addedURL = await uploadData(ipfsPath, request, isFormData, signal)

      return {
        status: 201,
        headers: {
          ...defaultHeaders,
          Location: addedURL
        },
        body: addedURL
      }
    })

    router.put(`ipns://${SPECIAL_HOSTNAME}/`, onNotFound)
    router.put('ipns://**/**', async (request) => {
      const { url, signal, headers } = request
      const contentType = headers.get('Content-Type') || ''
      const isFormData = contentType.includes('multipart/form-data')

      let ipfsPath = urlToIPNSPath(url)
      const split = ipfsPath.split('/')
      const keyName = split[0]
      const subpath = split.slice(1).join('/')

      if (isFormData || subpath) {
        // Resolve to current CID before writing over it
        try {
          ipfsPath = await resolveIPNS(keyName)
          if (ipfsPath.startsWith('/ipfs/')) ipfsPath = ipfsPath.slice('/ipfs/'.length)
          ipfsPath += `/${subpath}`
        } catch (e) {
          // console.error(e)
          // If CID couldn't be resolved from the key, use the subpath
          // TODO: Detect specific issues
          ipfsPath = subpath
        }

        const addedURL = await uploadData(ipfsPath, request, isFormData, signal)
        // We just want the new root CID, not the full path to the file
        const cid = addedURL.slice('ipfs://'.length).split('/')[0]
        const value = `/ipfs/${cid}/`

        return updateIPNS(keyName, value)
      }
    })

    router.post('ipns://*/', async (request) => {
      const { url, signal } = request
      const { hostname: keyName } = new URL(url)

      const rawValue = await request.text()
      const value = rawValue.replace(/^ipfs:\/\//, '/ipfs/').replace(/^ipns:\/\//, '/ipns/')

      return updateIPNS(keyName, value, signal)
    })

    router.delete('ipfs://*/**', async ({ url, signal }) => {
      const ipfsPath = urlToIPFSPath(url)

      return deleteData(ipfsPath, signal)
    })
    router.delete('ipns://*/**', async ({ url, signal }) => {
      let ipfsPath = urlToIPFSPath(url)
      ipfsPath = await resolveIPNS(ipfsPath, signal)
      return deleteData(ipfsPath, signal)
    })
  }

  // These are all reserved domains for later use
  router.head(`ipfs://${SPECIAL_HOSTNAME}/**`, onNotFound)
  router.get(`ipfs://${SPECIAL_HOSTNAME}/**`, onNotFound)
  router.head(`ipns://${SPECIAL_HOSTNAME}/`, onNotFound)
  router.get(`ipns://${SPECIAL_HOSTNAME}/`, onNotFound)

  router.head('ipfs://*/**', async ({ url, signal }) => {
    const { searchParams } = new URL(url)
    const ipfsPath = urlToIPFSPath(url)

    return serveHead(ipfsPath, searchParams, signal)
  })
  router.head('ipns://*/**', async ({ url, signal }) => {
    const { searchParams } = new URL(url)
    let ipfsPath = urlToIPNSPath(url)
    ipfsPath = await resolveIPNS(ipfsPath, signal)
    return serveHead(ipfsPath, searchParams, signal)
  })

  router.get('ipfs://*/**', async ({ url, signal, headers }) => {
    const { searchParams } = new URL(url)
    const ipfsPath = urlToIPFSPath(url)

    return serveGet(url, ipfsPath, searchParams, headers, signal)
  })
  router.get('ipns://*/**', async ({ url, signal, headers }) => {
    const { searchParams } = new URL(url)
    let ipfsPath = urlToIPNSPath(url)
    ipfsPath = await resolveIPNS(ipfsPath, signal)
    return serveGet(url, ipfsPath, searchParams, headers, signal)
  })

  async function serveGet (url, ipfsPath, searchParams, reqHeaders, signal) {
    const format = searchParams.get('format')
    const accept = reqHeaders.get('Accept') || ''
    const expectedType = format || accept

    const headers = { ...defaultHeaders }

    if (expectedType === 'raw' || expectedType === 'application/vnd.ipld.raw') {
      const body = await ipfs.block.get(ipfsPath, {
        timeout,
        signal
      })

      headers['Content-Type'] = 'application/vnd.ipld.raw'

      return {
        status: 200,
        headers,
        body
      }
    }

    if (expectedType === 'car' || expectedType === 'application/vnd.ipld.car') {
      const { cid } = await ipfs.dag.resolve(ipfsPath, {
        timeout,
        signal
      })
      // must resolve to a CID to export, paths not supported here
      const body = ipfs.dag.export(cid, {
        timeout,
        signal
      })

      headers['Content-Type'] = 'application/vnd.ipld.car'

      return {
        status: 200,
        headers,
        body
      }
    }

    const stat = await getStat(ipfsPath)

    if (stat.type === 'directory') {
      // Probably a directory

      let body = null

      try {
        const stats = await collect(ipfs.ls(ipfsPath, { signal, timeout }))
        const files = stats.map(({ name, type }) => (type === 'dir') ? `${name}/` : name)

        if (files.includes('index.html')) {
          if (!searchParams.has('noResolve')) {
            return serveFile(posixPath.join(ipfsPath, 'index.html'), searchParams, reqHeaders, headers, signal)
          }
        }

        if (accept.includes('text/html')) {
          const page = await renderIndex(url, files, fetch)
          headers['Content-Type'] = 'text/html; charset=utf-8'
          body = page
        } else {
          const json = JSON.stringify(files, null, '\t')
          headers['Content-Type'] = 'application/json; charset=utf-8'
          body = json
        }

        return {
          status: 200,
          headers,
          body
        }
      } catch {
        return serveFile(ipfsPath, searchParams, reqHeaders, headers, signal)
      }
    } else {
      return serveFile(ipfsPath, searchParams, reqHeaders, headers, signal)
    }
  }

  async function serveHead (ipfsPath, searchParams, signal) {
    const noResolve = searchParams.has('noResolve')

    const stat = await getStat(ipfsPath)

    if (stat.type === 'directory') {
      // TODO: Something for directories?
      if (!noResolve) {
        const stats = await collect(ipfs.ls(ipfsPath, {
          signal,
          timeout
        }))
        const files = stats.map(({ name, type }) => (type === 'dir') ? `${name}/` : name)
        if (files.includes('index.html')) {
          ipfsPath = posixPath.join(ipfsPath, 'index.html')
        } else {
          return {
            status: 200,
            headers: defaultHeaders
          }
        }
      }
    }

    const finalStat = await getStat(ipfsPath, signal)
    const { size } = finalStat
    const mimeName = searchParams.get('filename') || ipfsPath

    return {
      status: 200,
      headers: {
        ...defaultHeaders,
        'Accept-Ranges': 'bytes',
        'Content-Type': getMimeType(mimeName),
        'Content-Length': `${size}`
      }
    }
  }

  async function serveFile (path, searchParams, reqHeaders, headers = { ...defaultHeaders }, signal) {
    headers['Accept-Ranges'] = 'bytes'

    // Probably a file
    const isRanged = reqHeaders.get('Range') || ''
    const file = await getStat(path)
    const { size } = file
    const mimeName = searchParams.get('filename') || path

    headers['Content-Type'] = getMimeType(mimeName)

    if (isRanged) {
      const ranges = parseRange(size, isRanged)
      if (ranges && ranges.length && ranges.type === 'bytes') {
        const [{ start, end }] = ranges
        const length = (end - start + 1)
        headers['Content-Length'] = `${length}`
        headers['Content-Range'] = `bytes ${start}-${end}/${size}`
        return {
          status: 206,
          headers,
          body: ipfs.cat(path, { signal, offset: start, length, timeout })
        }
      } else {
        headers['Content-Length'] = `${size}`
        return {
          status: 200,
          headers,
          body: ipfs.cat(path, { signal, timeout })
        }
      }
    } else {
      headers['Content-Length'] = `${size}`
      return {
        status: 200,
        headers,
        body: ipfs.cat(path, { signal, timeout })
      }
    }
  }

  async function getStat (path, signal) {
    return exporter(path, ipfs.block, { signal, preload: false, timeout })
  }

  async function resolveIPNS (path, signal) {
    const segments = ensureStartingSlash(path).split(/\/+/)
    let mainSegment = segments[1]

    if (!mainSegment.includes('.')) {
      const keys = await ipfs.key.list({ signal, timeout: ipnsTimeout })
      const keyForName = keys.find(({ name }) => name === mainSegment)
      if (keyForName) {
        mainSegment = keyForName.id + '/'
      }
    }

    const toResolve = `/ipns${ensureEndingSlash(ensureStartingSlash(mainSegment))}`
    const resolved = await ipfs.resolve(toResolve, { signal, timeout: ipnsTimeout })
    return [resolved, ...segments.slice(2)].join('/')
  }

  async function updateIPNS (keyName, value, signal) {
    const existing = await hasKey(keyName)
    if (!existing) {
      await genKey(keyName, signal)
    }

    const finalName = existing ? existing.name : keyName

    const publish = await ipfs.name.publish(value, {
      allowOffline: true,
      key: finalName,
      signal,
      timeout: ipnsTimeout
    })
    const { name: cid } = publish

    const ipnsURL = `ipns://${cid}/`

    return {
      status: 201,
      headers: {
        ...defaultHeaders,
        Location: ipnsURL
      },
      body: ipnsURL
    }
  }
  async function genKey (keyName, signal) {
    await ipfs.key.gen(keyName, {
      signal,
      type: 'rsa',
      size: 2048,
      timeout: ipnsTimeout
    })
  }

  async function hasKey (keyName, signal) {
    const keys = await ipfs.key.list({
      signal,
      timeout: ipnsTimeout
    })

    return keys.find(({ name, id }) => {
      if (name === keyName) return true
      try {
        return (CID.parse(id, bases).toV1().toString(base36) === keyName)
      } catch {
        return false
      }
    })
  }

  async function deleteData (ipfsPath, signal) {
    const tmpDir = makeTmpDir()
    const { rootCID, relativePath } = cidFromPath(ipfsPath)

    if (rootCID) {
      await ipfs.files.cp(rootCID, tmpDir, {
        parents: true,
        cidVersion: 1,
        signal,
        timeout
      })
    }

    await ipfs.files.rm(posixPath.join(tmpDir, relativePath), {
      recursive: true,
      cidVersion: 1,
      signal,
      timeout
    })

    const { cid } = await ipfs.files.stat(tmpDir, {
      hash: true,
      signal,
      timeout
    })

    const cidHash = cid.toString()
    const addedURL = `ipfs://${cidHash}/`

    return {
      statusCode: 200,
      headers: {
        ...defaultHeaders,
        Location: addedURL
      },
      body: addedURL
    }
  }

  async function uploadData (ipfsPath, response, isFormData, signal) {
    const tmpDir = makeTmpDir()
    const { rootCID, relativePath } = cidFromPath(ipfsPath)

    if (rootCID) {
      await ipfs.files.cp(rootCID, tmpDir, {
        parents: true,
        cidVersion: 1,
        signal,
        timeout
      })
    }

    if (isFormData) {
      const formData = await response.formData()
      const toWait = []

      for (const [fieldName, fileData] of formData) {
        // TODO: Should we filter by field name?
        if (fieldName !== 'file') continue
        // Must not be a file
        if (!fileData.name) continue
        const fileName = fileData.name
        const finalPath = posixPath.join(tmpDir, relativePath, fileName)
        const result = ipfs.files.write(finalPath, fileData, {
          cidVersion: 1,
          parents: true,
          truncate: true,
          create: true,
          rawLeaves: true,
          signal,
          timeout
        })
        toWait.push(result)
      }

      await Promise.all(toWait)
    } else {
      const path = posixPath.join(tmpDir, ensureStartingSlash(stripEndingSlash(relativePath)))

      await ipfs.files.write(path, await response.blob(), {
        signal,
        parents: true,
        truncate: true,
        create: true,
        rawLeaves: true,
        cidVersion: 1,
        timeout
      })
    }

    const { cid } = await ipfs.files.stat(tmpDir, { hash: true, signal, timeout })

    const cidHash = cid.toString()
    const endPath = isFormData ? relativePath : stripEndingSlash(relativePath)
    const addedURL = `ipfs://${cidHash}${ensureStartingSlash(endPath)}`

    return addedURL
  }

  async function getNode (cid) {
    const { value } = await ipfs.dag.get(cid, {
      timeout
    })
    return value
  }

  return fetch
}

async function collect (iterable) {
  const result = []
  for await (const item of iterable) {
    result.push(item)
  }

  return result
}

function ensureStartingSlash (path) {
  if (!path.startsWith('/')) return '/' + path
  return path
}

function ensureEndingSlash (path) {
  if (!path.endsWith('/')) return path + '/'
  return path
}

function stripEndingSlash (path) {
  if (path.endsWith('/')) return path.slice(0, -1)
  return path
}

function getMimeType (path) {
  let mimeType = mime.getType(path) || 'text/plain'
  if (mimeType.startsWith('text/')) mimeType = `${mimeType}; charset=utf-8`
  return mimeType
}

function makeTmpDir () {
  const random = crypto.randomBytes(8).toString('hex')
  return `/ipfs-fetch-dirs/${random}`
}

function cidFromPath (path) {
  const components = path.split('/')
  if (path.startsWith('/ipfs/')) components.shift()
  if (path.startsWith('/')) components.shift()
  try {
    const cidComponent = components[0]
    const relativePath = components.slice(1).join('/')
    const rootCID = CID.parse(cidComponent, bases)
    return {
      rootCID,
      relativePath
    }
  } catch (e) {
    return {
      rootCID: null,
      relativePath: path
    }
  }
}

function keyToURL ({ id }) {
  const hostname = CID.parse(id, bases).toV1().toString(base36)
  return `ipns://${hostname}/`
}

function urlToIPFSPath (url) {
  const { pathname, hostname } = new URL(url)
  return `/ipfs/${hostname}${pathname}`
}
function urlToIPNSPath (url) {
  const { pathname, hostname } = new URL(url)
  return `/ipns/${hostname}${pathname}`
}
