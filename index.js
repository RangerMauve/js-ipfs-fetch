const makeFetch = require('make-fetch')
const parseRange = require('range-parser')
const mime = require('mime/lite')
const { CID } = require('multiformats/cid')
const { base32 } = require('multiformats/bases/base32')
const { base36 } = require('multiformats/bases/base36')
const Busboy = require('busboy')
const { Readable } = require('stream')
const { EventIterator } = require('event-iterator')
const crypto = require('crypto')
const posixPath = require('path').posix
const { exporter } = require('ipfs-unixfs-exporter')

const bases = base32.decoder.or(base36.decoder)

const IPFS_TIMEOUT = 30000
const IPNS_TIMEOUT = 120000
const SUPPORTED_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE']
const SPECIAL_HOSTNAME = 'localhost'

module.exports = function makeIPFSFetch ({
  ipfs,
  ipfsTimeout = IPFS_TIMEOUT,
  ipnsTimeout = IPNS_TIMEOUT
}) {
  return makeFetch(async ({ url, headers: reqHeaders, method, signal, body }) => {
    const { hostname, pathname, protocol, searchParams } = new URL(url)
    let ipfsPath = hostname ? hostname + pathname : pathname.slice(1)

    const headers = {}

    headers.Allow = SUPPORTED_METHODS.join(', ')

    async function getStat (path) {
      return exporter(path, ipfs.block, { signal, preload: false, timeout: ipfsTimeout })
    }

    async function serveFile (path = ipfsPath) {
      headers['Accept-Ranges'] = 'bytes'

      // Probably a file
      const isRanged = reqHeaders.Range || reqHeaders.range
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
            statusCode: 206,
            headers,
            data: ipfs.cat(path, { signal, offset: start, length, timeout: ipfsTimeout })
          }
        } else {
          headers['Content-Length'] = `${size}`
          return {
            statusCode: 200,
            headers,
            data: ipfs.cat(path, { signal, timeout: ipfsTimeout })
          }
        }
      } else {
        headers['Content-Length'] = `${size}`
        return {
          statusCode: 200,
          headers,
          data: ipfs.cat(path, { signal, timeout: ipfsTimeout })
        }
      }
    }

    async function uploadData (path, content, isFormData) {
      const tmpDir = makeTmpDir()
      const { rootCID, relativePath } = cidFromPath(path)

      if (rootCID) {
        await ipfs.files.cp(rootCID, tmpDir, {
          parents: true,
          cidVersion: 1,
          signal,
          timeout: ipfsTimeout
        })
      }

      // Handle multipart formdata uploads
      if (isFormData) {
        const busboy = new Busboy({ headers: reqHeaders })

        const toUpload = new EventIterator(({ push, stop, fail }) => {
          busboy.once('error', fail)
          busboy.once('finish', stop)

          busboy.on('file', async (fieldName, fileData, fileName) => {
            const finalPath = posixPath.join(tmpDir, relativePath, fileName)
            try {
              const result = ipfs.files.write(finalPath, Readable.from(fileData), {
                cidVersion: 1,
                parents: true,
                truncate: true,
                create: true,
                rawLeaves: false,
                signal,
                timeout: ipfsTimeout
              })
              push(result)
            } catch (e) {
              fail(e)
            }
          })

          // TODO: Does busboy need to be GC'd?
          return () => {}
        })

        // Parse body as a multipart form
        // TODO: Readable.from doesn't work in browsers
        Readable.from(content).pipe(busboy)

        // toUpload is an async iterator of promises
        // We collect the promises (all files are queued for upload)
        // Then we wait for all of them to resolve
        await Promise.all(await collect(toUpload))
      } else {
        // Node.js and browsers handle pathnames differently for IPFS URLs
        const path = posixPath.join(tmpDir, ensureStartingSlash(stripEndingSlash(relativePath)))

        await ipfs.files.write(path, Readable.from(content), {
          signal,
          parents: true,
          truncate: true,
          create: true,
          rawLeaves: false,
          cidVersion: 1,
          timeout: ipfsTimeout
        })
      }

      const { cid } = await ipfs.files.stat(tmpDir, { hash: true, signal, timeout: ipfsTimeout })

      const cidHash = cid.toString()
      const endPath = isFormData ? relativePath : stripEndingSlash(relativePath)
      const addedURL = `ipfs://${cidHash}${ensureStartingSlash(endPath)}`

      return addedURL
    }

    // Split out IPNS info and put it back together to resolve.
    async function resolveIPNS (path) {
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

    async function genKey (keyName) {
      await ipfs.key.gen(keyName, {
        signal,
        type: 'rsa',
        size: 2048,
        timeout: ipnsTimeout
      })
    }

    async function hasKey (keyName) {
      const keys = await ipfs.key.list({ signal, timeout: ipnsTimeout })
      return keys.find(({ name, id }) => {
        if (name === keyName) return true
        try {
          return (CID.parse(id, bases).toV1().toString(base36) === keyName)
        } catch {
          return false
        }
      })
    }

    async function updateIPNS (keyName, value) {
      const existing = await hasKey(keyName)
      if (!existing) {
        await genKey(keyName)
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
      headers.Location = ipnsURL

      return {
        statusCode: 201,
        headers,
        data: intoAsyncIterable(ipnsURL)
      }
    }

    try {
      if (protocol === 'pubsub:') {
        const topic = hostname
        if (method === 'GET') {
          const format = searchParams.get('format')
          const accept = reqHeaders.Accept || reqHeaders.accept
          if (accept && accept.includes('text/event-stream')) {
            const events = new EventIterator(({ push, fail }) => {
              function handler ({ from, sequenceNumber, data, topicIDs: topics }) {
                const id = sequenceNumber.toString()
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
              }
              ipfs.pubsub.subscribe(topic, handler).catch((e) => {
                fail(e)
              })
              return () => ipfs.pubsub.unsubscribe(topic, handler)
            })

            headers['Content-Type'] = 'text/event-stream'

            return {
              statusCode: 200,
              headers,
              data: events
            }
          } else {
            const id = await ipfs.id()
            const subs = await ipfs.pubsub.ls()
            const subscribed = subs.includes(topic)

            headers['Content-Type'] = 'application/json'

            return {
              statusCode: 200,
              headers,
              data: intoAsyncIterable(JSON.stringify({
                id,
                topic,
                subscribed
              }, null, '\t'))
            }
          }
        } else if (method === 'POST') {
          const payload = await collect(body)
          // TODO: Handle oversized messages wihth 413
          await ipfs.pubsub.publish(topic, payload, {
            signal,
            timeout: ipfsTimeout
          })

          return {
            statusCode: 200,
            headers,
            data: intoAsyncIterable('')
          }
        }
      } else if (hostname === SPECIAL_HOSTNAME) {
        if (protocol === 'ipns:') {
          const key = searchParams.get('key')

          if (method === 'GET') {
            const exists = await hasKey(key)
            if (!exists) {
              return {
                statusCode: 404,
                headers,
                data: intoAsyncIterable('Key Not Found')
              }
            } else {
              const keyURL = keyToURL(exists)
              headers.Location = keyURL
              return {
                statusCode: 302,
                headers,
                data: intoAsyncIterable(keyURL)
              }
            }
          } else if (method === 'POST') {
            // Localhost is used for generating keys
            const exists = await hasKey(key)
            if (!exists) {
              await genKey(key)
            }
            const keyData = await hasKey(key)
            const keyURL = keyToURL(keyData)
            headers.Location = keyURL

            return {
              statusCode: 201,
              headers,
              data: intoAsyncIterable('')
            }
          } else if (method === 'DELETE') {
            await ipfs.key.rm(key, {
              signal,
              timeout: ipfsTimeout
            })

            return {
              statusCode: 200,
              headers,
              body: intoAsyncIterable('')
            }
          } else {
            return {
              statusCode: 405,
              headers,
              data: intoAsyncIterable('Method Not Supported')
            }
          }
        } else {
          return {
            statusCode: 405,
            headers,
            data: intoAsyncIterable('Protocol not supported for localhost')
          }
        }
      } else if (protocol === 'ipfs:' && ((method === 'POST') || (method === 'PUT'))) {
        // TODO: Deprecate using POST to upload data, use PUT instead
        // Handle multipart formdata uploads
        const contentType = reqHeaders['Content-Type'] || reqHeaders['content-type']
        const isFormData = contentType && contentType.includes('multipart/form-data')

        const addedURL = await uploadData(ipfsPath, body, isFormData)

        headers.Location = addedURL

        return {
          statusCode: 201,
          headers,
          data: intoAsyncIterable(addedURL)
        }
      } else if (method === 'HEAD') {
        if (protocol === 'ipns:') {
          ipfsPath = await resolveIPNS(ipfsPath)
        }
        const stat = await getStat(ipfsPath)
        if (stat.type === 'directory') {
          // TODO: Something for directories?
          if (!searchParams.has('noResolve')) {
            const stats = await collect(ipfs.ls(ipfsPath, { signal, timeout: ipfsTimeout }))
            const files = stats.map(({ name, type }) => (type === 'dir') ? `${name}/` : name)
            if (files.includes('index.html')) {
              ipfsPath = posixPath.join(ipfsPath, 'index.html')
            } else {
              return {
                statusCode: 200,
                headers,
                data: intoAsyncIterable('')
              }
            }
          }
        }
        const finalStat = await getStat(ipfsPath)
        const { size } = finalStat
        const mimeName = searchParams.get('filename') || ipfsPath

        headers['Accept-Ranges'] = 'bytes'
        headers['Content-Type'] = getMimeType(mimeName)
        headers['Content-Length'] = `${size}`

        return {
          statusCode: 200,
          headers,
          data: intoAsyncIterable('')
        }
      } else if (method === 'GET') {
        if (protocol === 'ipns:') {
          ipfsPath = await resolveIPNS(ipfsPath)
        }

        const stat = await getStat(ipfsPath)

        if (stat.type === 'directory') {
          // Probably a directory

          let data = null

          try {
            const stats = await collect(ipfs.ls(ipfsPath, { signal, timeout: ipfsTimeout }))
            const files = stats.map(({ name, type }) => (type === 'dir') ? `${name}/` : name)

            if (files.includes('index.html')) {
              if (!searchParams.has('noResolve')) {
                return serveFile(posixPath.join(ipfsPath, 'index.html'))
              }
            }

            const accept = reqHeaders.Accept || reqHeaders.accept
            if (accept && accept.includes('text/html')) {
              const page = `
<!DOCTYPE html>
<title>${url}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<h1>Index of ${pathname}</h1>
<ul>
  <li><a href="../">../</a></li>${files.map((file) => `
  <li><a href="${file}">./${file}</a></li>
`).join('')}
</ul>
`
              headers['Content-Type'] = 'text/html; charset=utf-8'
              data = page
            } else {
              const json = JSON.stringify(files, null, '\t')
              headers['Content-Type'] = 'application/json; charset=utf-8'
              data = json
            }

            return {
              statusCode: 200,
              headers,
              data: intoAsyncIterable(data)
            }
          } catch {
            return serveFile()
          }
        } else {
          return serveFile()
        }
      } else if (protocol === 'ipns:' && ((method === 'POST') || (method === 'PUT'))) {
        // Handle multipart formdata uploads
        const contentType = reqHeaders['Content-Type'] || reqHeaders['content-type']
        const isFormData = contentType && contentType.includes('multipart/form-data')

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

          const addedURL = await uploadData(ipfsPath, body, isFormData)
          // We just want the new root CID, not the full path to the file
          const cid = addedURL.slice('ipfs://'.length).split('/')[0]
          const value = `/ipfs/${cid}/`

          return updateIPNS(keyName, value)
        } else {
          const rawValue = await collectString(body)
          const value = rawValue.replace(/^ipfs:\/\//, '/ipfs/').replace(/^ipns:\/\//, '/ipns/')
          return updateIPNS(keyName, value)
        }
      } else if (method === 'DELETE') {
        if (protocol === 'ipns:') {
          ipfsPath = await resolveIPNS(ipfsPath)
        }

        const tmpDir = makeTmpDir()
        const { rootCID, relativePath } = cidFromPath(ipfsPath)

        if (rootCID) {
          await ipfs.files.cp(rootCID, tmpDir, {
            parents: true,
            cidVersion: 1,
            signal,
            timeout: ipfsTimeout
          })
        }

        await ipfs.files.rm(posixPath.join(tmpDir, relativePath), {
          recursive: true,
          cidVersion: 1,
          signal,
          timeout: ipfsTimeout
        })

        const { cid } = await ipfs.files.stat(tmpDir, {
          hash: true,
          signal,
          timeout: ipfsTimeout
        })

        const cidHash = cid.toString()
        const addedURL = `ipfs://${cidHash}/`

        headers.Location = addedURL

        return {
          statusCode: 200,
          headers,
          data: intoAsyncIterable(addedURL)
        }
      } else {
        return {
          statusCode: 405,
          headers,
          data: intoAsyncIterable('')
        }
      }
    } catch (e) {
      const statusCode = (() => {
        if (e.code === 'ERR_NOT_FOUND') {
          return 404
        } else if (e.name === 'TimeoutError') {
          return 408
        } else {
          return 500
        }
      })(e)
      console.error(e.stack)
      return {
        statusCode,
        headers,
        data: intoAsyncIterable(e.stack)
      }
    }
  })
}

async function * intoAsyncIterable (data) {
  yield Buffer.from(data)
}

async function collect (iterable) {
  const result = []
  for await (const item of iterable) {
    result.push(item)
  }

  return result
}

async function collectString (iterable) {
  const items = await collect(iterable)

  return items.map((item) => item.toString()).join('')
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
  if (path.startsWith('/')) components.shift()
  try {
    const cidComponent = components[0]
    const relativePath = components.slice(1).join('/')
    const rootCID = CID.parse(cidComponent, bases)
    return {
      rootCID,
      relativePath
    }
  } catch {
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
