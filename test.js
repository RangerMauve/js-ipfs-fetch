global.Buffer = Buffer

const test = require('tape')
const IPFS = require('ipfs')
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

    const { cid } = await ipfs.add(TEST_DATA)

    const response = await fetch(`ipfs://${cid}`)

    t.ok(response, 'Got a response object')
    t.equal(response.status, 200, 'Got OK in response')

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

    const { cid } = await ipfs.add(TEST_DATA)

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

    const { cid } = await ipfs.add(TEST_DATA)

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

test('Publish and ressolve IPNS', async (t) => {
  var ipfs = null
  try {
    ipfs = await IPFS.create({ silent: true, offline: true })

    const fetch = await makeIPFSFetch({ ipfs })

    t.pass('Able to make create fetch instance')
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
