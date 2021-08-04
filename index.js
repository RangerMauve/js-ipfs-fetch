const makeFetch = require('make-fetch')
const parseRange = require('range-parser')
const mime = require('mime/lite')
const CID = require('cids')
const Busboy = require('busboy')
const { Readable } = require('stream')
const { EventIterator } = require('event-iterator')
const crypto = require('crypto')
const { join } = require('path')

const SUPPORTED_METHODS = ['GET', 'HEAD', 'POST']

function makePotentialPaths (path) {
  return [
  `${path}`,
  `${path}/index.html`,
  `${path}index.html`,
  `${path}.html`
  ]
}

module.exports = function makeIPFSFetch ({ ipfs }) {
  return makeFetch(async ({ url, headers: reqHeaders, method, signal, body }) => {
    const { hostname, pathname, protocol, searchParams } = new URL(url)
    let ipfsPath = hostname ? hostname + pathname : pathname.slice(1)

    const headers = {}

    headers.Allow = SUPPORTED_METHODS.join(', ')

    // Split out IPNS info and put it back together to resolve.
    async function resolveIPNS (path) {
      const segments = ensureStartingSlash(path).split(/\/+/)
      let mainSegment = segments[1]

      if (!mainSegment.includes('.')) {
        const keys = await ipfs.key.list({ signal })
        const keyForName = keys.find(({ name }) => name === mainSegment)
        if (keyForName) {
          mainSegment = keyForName.id
        }
      }
      const toResolve = `/ipns${ensureStartingSlash(mainSegment)}`
      const resolved = await ipfs.resolve(toResolve, { signal })
      return [resolved, ...segments.slice(2)].join('/')
    }

    async function getFile (path) {
      let firstErr = null
      for (const toTry of makePotentialPaths(path)) {
        try {
          const files = await collect(ipfs.get(toTry, { signal, preload: false }))

          // It's probably a directory, but we need a single file
          if (files.length > 1) continue

          const [file] = files
          return { file, path: toTry }
        } catch (e) {
          firstErr = firstErr || e
        }
      }
      throw firstErr
    }

    async function serveFile () {
      headers['Accept-Ranges'] = 'bytes'

      // Probably a file
      const isRanged = reqHeaders.Range || reqHeaders.range
      const { file, path } = await getFile(ipfsPath)
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
            data: ipfs.cat(path, { signal, offset: start, length })
          }
        } else {
          headers['Content-Length'] = `${size}`
          return {
            statusCode: 200,
            headers,
            data: ipfs.cat(path, { signal })
          }
        }
      } else {
        headers['Content-Length'] = `${size}`
        return {
          statusCode: 200,
          headers,
          data: ipfs.cat(path, { signal })
        }
      }
    }

    async function uploadData (path, content, isFormData) {
      const tmpDir = makeTmpDir()
      const { rootCID, relativePath } = cidFromPath(path)
      try {
        if (rootCID) {
          await ipfs.files.cp(rootCID, tmpDir, {
            parents: true,
            cidVersion: 1,
            signal
          })
        }

        // Handle multipart formdata uploads
        if (isFormData) {
          const busboy = new Busboy({ headers: reqHeaders })

          const toUpload = new EventIterator(({ push, stop, fail }) => {
            busboy.once('error', fail)
            busboy.once('finish', stop)

            busboy.on('file', async (fieldName, fileData, fileName) => {
              const finalPath = join(tmpDir, relativePath, fileName)
              try {
                const result = ipfs.files.write(finalPath, Readable.from(fileData), {
                  cidVersion: 1,
                  parents: true,
                  create: true,
                  signal
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
          const path = join(tmpDir, ensureStartingSlash(stripEndingSlash(relativePath)))

          await ipfs.files.write(path, content, {
            signal,
            parents: true,
            create: true,
            cidVersion: 1
          })
        }

        const { cid } = await ipfs.files.stat(tmpDir, { hash: true, signal })

        const cidHash = cid.toString()
        const addedURL = `ipfs://${cidHash}${ensureStartingSlash(relativePath)}`

        return addedURL
      } finally {
        await ipfs.files.rm(tmpDir, { recursive: true, signal })
      }
    }

    async function updateIPNS (keyName, value) {
      const keys = await ipfs.key.list({ signal })
      const existing = keys.find(({ name, id }) => (name === keyName) || (new CID(id).toV1().toString('base36') === keyName))
      if (!existing) {
        await ipfs.key.gen(keyName, { signal })
      }

      const finalName = existing ? existing.name : keyName

      const { name: cid } = await ipfs.name.publish(value, { name: finalName, signal })
      const hash = new CID(cid).toV1().toString('base36')

      const ipnsURL = `ipns://${hash}/`
      return {
        statusCode: 200,
        headers,
        data: intoAsyncIterable(ipnsURL)
      }
    }

    try {
      if (method === 'POST' && protocol === 'ipfs:') {
        // Handle multipart formdata uploads
        const contentType = reqHeaders['Content-Type'] || reqHeaders['content-type']
        const isFormData = contentType && contentType.includes('multipart/form-data')

        const addedURL = await uploadData(ipfsPath, body, isFormData)

        return {
          statusCode: 200,
          headers,
          data: intoAsyncIterable(addedURL)
        }
      } else if (method === 'HEAD') {
        if (protocol === 'ipns:') {
          ipfsPath = await resolveIPNS(ipfsPath)
        }
        if (pathname.endsWith('/')) {
          await collect(ipfs.ls(ipfsPath, { signal }))
        } else {
          headers['Accept-Ranges'] = 'bytes'
          const { file, path } = await getFile(ipfsPath)
          const { size } = file
          headers['Content-Type'] = getMimeType(path)
          headers['Content-Length'] = `${size}`
        }
        return {
          statusCode: 200,
          headers,
          data: intoAsyncIterable('')
        }
      } else if (method === 'GET') {
        if (pathname.endsWith('/')) {
          // Probably a directory
          if (protocol === 'ipns:') {
            ipfsPath = await resolveIPNS(ipfsPath)
          }

          let data = null

          try {
            const stats = await collect(ipfs.ls(ipfsPath, { signal }))
            const files = stats.map(({ name, type }) => (type === 'dir') ? `${name}/` : name)

            if (files.includes('index.html')) {
              if (!searchParams.has('noResolve')) {
                return serveFile()
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
          if (protocol === 'ipns:') {
            ipfsPath = await resolveIPNS(ipfsPath)
          }
          return serveFile()
        }
      } else if (method === 'POST' && protocol === 'ipns:') {
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
          } catch {
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
      } else {
        return {
          statusCode: 405,
          headers,
          data: intoAsyncIterable('')
        }
      }
    } catch (e) {
      const statusCode = e.code === 'ERR_NOT_FOUND' ? 404 : 500
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
  return `/ipfs-fetch-dirs/${random}/`
}

function cidFromPath (path) {
  const components = path.split('/')
  if (path.startsWith('/')) components.shift()
  try {
    const rootCID = new CID(components[0])
    return {
      rootCID,
      relativePath: components.slice(1).join('/')
    }
  } catch {
    return {
      rootCID: null,
      relativePath: path
    }
  }
}
