const makeFetch = require('make-fetch')
const parseRange = require('range-parser')

const SUPPORTED_METHODS = ['GET', 'HEAD']

module.exports = function makeIPFSFetch ({ ipfs }) {
  return makeFetch(async ({ url, headers: reqHeaders, method, signal }) => {
    const { hostname, pathname } = new URL(url)
    const ipfsPath = hostname ? hostname + pathname : pathname.slice(1)

    const headers = {}

    headers.Allow = SUPPORTED_METHODS.join(', ')

    try {
      if (method === 'HEAD') {
        if (pathname.endsWith('/')) {
          await collect(ipfs.ls(ipfsPath, { signal }))
        } else {
          headers['Accept-Ranges'] = 'bytes'
          const [file] = await collect(ipfs.get(ipfsPath, { signal, preload: false }))
          const { size } = file
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

          let data = null

          const stats = await collect(ipfs.ls(ipfsPath, { signal }))
          const files = stats.map(({ name, type }) => (type === 'dir') ? `${name}/` : name)
          if (reqHeaders.Accept === 'application/json') {
            const json = JSON.stringify(files, null, '\t')
            data = intoAsyncIterable(json)
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
            headers['Content-Type'] = 'text/html'
            data = page
          }

          return {
            statusCode: 200,
            headers,
            data: intoAsyncIterable(data)
          }
        } else {
          headers['Accept-Ranges'] = 'bytes'

          // Probably a file
          const isRanged = reqHeaders.Range || reqHeaders.range
          const [{ size }] = await collect(ipfs.get(ipfsPath, { signal, preload: false }))

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
                data: ipfs.cat(ipfsPath, { signal, offset: start, length })
              }
            } else {
              headers['Content-Length'] = `${size}`
              return {
                statusCode: 200,
                headers,
                data: ipfs.cat(ipfsPath, { signal })
              }
            }
          } else {
            headers['Content-Length'] = `${size}`
            return {
              statusCode: 200,
              headers,
              data: ipfs.cat(ipfsPath, { signal })
            }
          }
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
