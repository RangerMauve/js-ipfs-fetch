const makeFetch = require('make-fetch')
const parseRange = require('range-parser')
const mime = require('mime/lite')
const CID = require('cids')

const SUPPORTED_METHODS = ['GET', 'HEAD', 'PUBLISH', 'POST']

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
    const { hostname, pathname, protocol } = new URL(url)
    let ipfsPath = hostname ? hostname + pathname : pathname.slice(1)

    const headers = {}

    headers.Allow = SUPPORTED_METHODS.join(', ')

    // Split out IPNS info and put it back together to resolve.
    async function resolveIPNS () {
      const segments = ensureSlash(ipfsPath).split(/\/+/)
      const mainSegment = segments[1]
      const toResolve = `/ipns${ensureSlash(mainSegment)}`
      const resolved = await ipfs.resolve(toResolve, { signal })
      ipfsPath = [resolved, ...segments.slice(2)].join('/')
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

      headers['Content-Type'] = getMimeType(path)

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

    try {
      if (method === 'POST') {
        // Node.js and browsers handle pathnames differently for IPFS URLs
        const path = ensureSlash(stripLeadingSlash(ipfsPath))
        const { cid } = await ipfs.add({
          path,
          content: body
        }, {
          cidVersion: 1,
          wrapWithDirectory: true
        })
        const cidHash = cid.toString()
        const addedURL = `ipfs://${cidHash}${path}`
        return {
          statusCode: 200,
          headers,
          data: intoAsyncIterable(addedURL)
        }
      } else if (method === 'HEAD') {
        if (protocol === 'ipns:') {
          await resolveIPNS()
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
            await resolveIPNS()
          }

          let data = null

          const stats = await collect(ipfs.ls(ipfsPath, { signal }))
          const files = stats.map(({ name, type }) => (type === 'dir') ? `${name}/` : name)

          if (files.includes('index.html')) {
            const resolveStrategy = reqHeaders['X-Resolve'] || reqHeaders['x-resolve']
            if (resolveStrategy !== 'none') {
              ipfsPath += 'index.html'
              return serveFile()
            }
          }
          if ((reqHeaders.Accept || reqHeaders.accept) === 'application/json') {
            const json = JSON.stringify(files, null, '\t')
            headers['Content-Type'] = 'application/json; charset=utf-8'
            data = json
          } else {
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
          }

          return {
            statusCode: 200,
            headers,
            data: intoAsyncIterable(data)
          }
        } else {
          if (protocol === 'ipns:') {
            await resolveIPNS()
          }
          return serveFile()
        }
      } else if (method === 'PUBLISH' && protocol === 'ipns:') {
        const keyName = stripSlash(ipfsPath)
        const rawValue = await collectString(body)
        const value = rawValue.replace(/^ipfs:\/\//, '/ipfs/').replace(/^ipns:\/\//, '/ipns/')

        const keys = await ipfs.key.list({ signal })
        if (!keys.some(({ name }) => name === keyName)) {
          await ipfs.key.gen(keyName, { signal })
        }

        const { name } = await ipfs.name.publish(value, { name: keyName, signal })
        const nameHash = new CID(name).toV1().toString('base36')

        const nameURL = `ipns://${nameHash}/`
        return {
          statusCode: 200,
          headers,
          data: intoAsyncIterable(nameURL)
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

function ensureSlash (path) {
  if (!path.startsWith('/')) return '/' + path
  return path
}

function stripLeadingSlash (path) {
  if (path.endsWith('/')) return path.slice(0, -1)
  return path
}

function stripSlash (path) {
  return path.replace(/\/+/, '')
}

function getMimeType (path) {
  let mimeType = mime.getType(path) || 'text/plain'
  if (mimeType.startsWith('text/')) mimeType = `${mimeType}; charset=utf-8`
  return mimeType
}
