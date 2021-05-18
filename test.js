global.Buffer = Buffer

const test = require('tape')
const IPFS = require('ipfs-core')
const makeIPFSFetch = require('./')

const TEST_DATA = 'Hello World!'

// Used for browser tests
test.onFinish(() => {
  if ((typeof window !== 'undefined') && window.close) window.close()
})

test('Load a file via fetch', async (t) => {
  var ipfs = null
  try {
    ipfs = await IPFS.create({ silent: true, offline: true })

    const fetch = await makeIPFSFetch({ ipfs })

    t.pass('Able to make create fetch instance')

    const { cid } = await ipfs.add(TEST_DATA, { cidVersion: 1 })

    const response = await fetch(`ipfs://${cid}`)

    t.ok(response, 'Got a response object')
    t.equal(response.status, 200, 'Got OK in response')

    const contentType = response.headers.get('Content-Type')
    t.equal(contentType, 'text/plain; charset=utf-8', 'Got expected content type')

    const text = await response.text()

    t.equal(text, TEST_DATA, 'Got expected file content')
  } catch (e) {
    t.fail(e.message)
  } finally {
    t.end()

    try {
      if (ipfs) await ipfs.stop()
    } catch {
      // Whatever
    }
  }
})

test('Load a range from a file', async (t) => {
  var ipfs = null
  try {
    ipfs = await IPFS.create({ silent: true, offline: true })

    const fetch = await makeIPFSFetch({ ipfs })

    t.pass('Able to make create fetch instance')

    const { cid } = await ipfs.add(TEST_DATA, { cidVersion: 1 })

    const response = await fetch(`ipfs://${cid}`, { headers: { Range: 'bytes=0-4' } })

    t.ok(response, 'Got a response object')
    t.equal(response.status, 206, 'Got partial response')

    const text = await response.text()

    t.equal(text, TEST_DATA.slice(0, 5), 'Got expected file content')
  } catch (e) {
    t.fail(e.message)
  } finally {
    t.end()

    try {
      if (ipfs) await ipfs.stop()
    } catch {
      // Whatever
    }
  }
})

test('Get expected headers from HEAD', async (t) => {
  var ipfs = null
  try {
    ipfs = await IPFS.create({ silent: true, offline: true })

    const fetch = await makeIPFSFetch({ ipfs })

    t.pass('Able to make create fetch instance')

    const { cid } = await ipfs.add(TEST_DATA, { cidVersion: 1 })

    const response = await fetch(`ipfs://${cid}`, { method: 'head' })

    t.ok(response, 'Got a response object')
    t.equal(response.status, 200, 'Got OK in response')

    const size = response.headers.get('Content-Length')
    t.equal(size, TEST_DATA.length.toString(), 'Got expected content length')
  } catch (e) {
    t.fail(e.message)
  } finally {
    t.end()

    try {
      if (ipfs) await ipfs.stop()
    } catch {
      // Whatever
    }
  }
})

test('Load a directory listing via fetch', async (t) => {
  var ipfs = null
  try {
    ipfs = await IPFS.create({ silent: true, offline: true })

    const fetch = await makeIPFSFetch({ ipfs })

    t.pass('Able to make create fetch instance')

    const results = await collect(ipfs.addAll([
      { path: '/example.txt', content: TEST_DATA },
      { path: '/example2.txt', content: TEST_DATA }
    ], { wrapWithDirectory: true }))

    // The last element should be the directory itself
    const { cid } = results[results.length - 1]

    const response = await fetch(`ipfs://${cid}/`)

    t.ok(response, 'Got a response object')
    t.equal(response.status, 200, 'Got OK in response')

    const text = await response.text()

    t.ok(text, 'Got directory listing')

    const jsonResponse = await fetch(`ipfs://${cid}/`, {
      headers: {
        Accept: 'application/json'
      }
    })

    t.equal(jsonResponse.status, 200, 'Got OK in response')

    const files = await jsonResponse.json()

    t.deepEqual(files, ['example.txt', 'example2.txt'], 'Got files in JSON form')
  } catch (e) {
    t.fail(e.message)
  } finally {
    t.end()

    try {
      if (ipfs) await ipfs.stop()
    } catch {
      // Whatever
    }
  }
})

test('Resolve index.html from a directory', async (t) => {
  var ipfs = null
  try {
    ipfs = await IPFS.create({ silent: true, offline: true })

    const fetch = await makeIPFSFetch({ ipfs })

    t.pass('Able to make create fetch instance')

    const results = await collect(ipfs.addAll([
      { path: '/index.html', content: TEST_DATA },
      { path: 'example/index.html', content: TEST_DATA }
    ], { wrapWithDirectory: true, cidVersion: 1 }))

    // The last element should be the directory itself
    const { cid } = results[results.length - 1]

    const response = await fetch(`ipfs://${cid}/`)

    t.ok(response, 'Got a response object')
    t.equal(response.status, 200, 'Got OK in response')

    const text = await response.text()

    t.equal(text, TEST_DATA, 'Got index from directory')

    const rawResponse = await fetch(`ipfs://${cid}/`, {
      headers: {
        'X-Resolve': 'none',
        Accept: 'application/json'
      }
    })

    t.equal(rawResponse.status, 200, 'Got OK in response')

    const files = await rawResponse.json()

    t.deepEqual(files, ['example/', 'index.html'], 'Got files in JSON form')

    const subfolderResponse = await fetch(`ipfs://${cid}/example`)

    t.ok(subfolderResponse, 'Got a response object')
    t.equal(subfolderResponse.status, 200, 'Got OK in response')

    const text2 = await subfolderResponse.text()

    t.equal(text2, TEST_DATA, 'Got index from directory')
  } catch (e) {
    t.fail(e.message)
  } finally {
    t.end()

    try {
      if (ipfs) await ipfs.stop()
    } catch {
      // Whatever
    }
  }
})

test('POST a file into IPFS', async (t) => {
  var ipfs = null
  try {
    ipfs = await IPFS.create({ silent: true, offline: true })

    const fetch = await makeIPFSFetch({ ipfs })

    t.pass('Able to make create fetch instance')

    const response = await fetch('ipfs:///example.txt', {
      method: 'post',
      body: TEST_DATA
    })

    t.ok(response, 'Got a response object')
    t.equal(response.status, 200, 'Got OK in response')

    const ipfsUri = await response.text()
    t.match(ipfsUri, /ipfs:\/\/\w+\/example.txt/, 'returned IPFS url with CID')

    const fileResponse = await fetch(ipfsUri)
    t.equal(fileResponse.status, 200, 'Got OK in response')

    const text = await fileResponse.text()
    t.equal(text, TEST_DATA, 'Able to load POSTed file')

    const { cid } = await ipfs.add({
      path: 'example.txt',
      content: TEST_DATA
    }, {
      cidVersion: 1,
      wrapWithDirectory: true
    })
    t.equal(ipfsUri.match(/ipfs:\/\/([^/]+)/)[1], cid.toString('base32'), 'Matches cid from ipfs.add')
  } catch (e) {
    t.fail(e.message)
  } finally {
    t.end()

    try {
      if (ipfs) await ipfs.stop()
    } catch {
      // Whatever
    }
  }
})

test('Publish and resolve IPNS', async (t) => {
  var ipfs = null
  try {
    ipfs = await IPFS.create({ silent: true, offline: false })

    const fetch = await makeIPFSFetch({ ipfs })

    t.pass('Able to make create fetch instance')

    const dataURI = await (await fetch('ipfs:///example.txt', { method: 'post', body: TEST_DATA })).text()
    const folderURI = dataURI.slice(0, -('example.txt'.length))

    const publishResponse = await fetch('ipns://example', { method: 'publish', body: folderURI })

    t.equal(publishResponse.status, 200, 'Got OK in response')

    const ipnsURI = await publishResponse.text()

    // base36 prefix is k https://github.com/multiformats/js-multibase/blob/ddd99e6d0d089d5d1209094f2e7a2a07d87729fb/src/constants.js#L43
    t.ok(ipnsURI.startsWith('ipns://k'), 'Got base36 encoded IPNS url')

    const resolvedResponse = await fetch(ipnsURI, {
      headers: {
        Accept: 'application/json'
      }
    })

    t.equal(resolvedResponse.status, 200, 'Got OK in response')

    const files = await resolvedResponse.json()

    t.deepEqual(files, ['example.txt'], 'resolved files')

    const dnsResponse = await fetch('ipns://ipfs.io/index.html')

    t.ok(dnsResponse.ok, 'Able to resolve ipfs.io')
  } catch (e) {
    t.fail(e.message)
  } finally {
    t.end()

    try {
      if (ipfs) await ipfs.stop()
    } catch {
      // Whatever
    }
  }
})

async function collect (iterable) {
  const results = []
  for await (const item of iterable) {
    results.push(item)
  }

  return results
}
