const test = require('tape')
const IPFS = require('ipfs')
const makeIPFSFetch = require('./')

const TEST_DATA = 'Hello World!'

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
      console.log(ipfs)
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
