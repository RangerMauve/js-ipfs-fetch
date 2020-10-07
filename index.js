const makeFetch = require('make-fetch')

module.exports = function makeIPFSFetch ({ ipfs }) {
  return makeFetch(async ({ url, headers: reqHeaders, method, signal }) => {
    const { hostname, pathname } = new URL(url)
    const ipfsPath = hostname ? hostname + pathname : pathname.slice(1)

    const headers = {}

    try {
      if (method === 'GET') {
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
          // Probably a file

          return {
            statusCode: 200,
            headers,
            data: ipfs.cat(ipfsPath)
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
      return {
        statusCode: 500,
        headers: {
          url
        },
        data: intoAsyncIterable(url)
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
