global.Buffer = Buffer

const test = require('tape')
const IPFS = require('ipfs-core')
const path = require('path')
const FormData = require('form-data')
const makeIPFSFetch = require('./')

const TEST_DATA = 'Hello World!'

// Used for browser tests
test.onFinish(() => {
  if ((typeof window !== 'undefined') && window.close) window.close()
})

function getInstance () {
  return IPFS.create({
    silent: true,
    offline: true,
    repo: path.join(__dirname, '.test-repo')
  })
}

test('Load a file via fetch', async (t) => {
  let ipfs = null
  try {
    ipfs = await getInstance()

    const fetch = await makeIPFSFetch({ ipfs })

    t.pass('Able to make create fetch instance')

    const results = await collect(ipfs.addAll([
      { path: '/example.txt', content: TEST_DATA }
    ], { wrapWithDirectory: true }))

    // The last element should be the directory itself
    const { cid } = results[results.length - 1]

    const response = await fetch(`ipfs://${cid}/example.txt`)

    t.ok(response, 'Got a response object')
    t.equal(response.status, 200, 'Got OK in response')

    const contentType = response.headers.get('Content-Type')
    t.equal(contentType, 'text/plain; charset=utf-8', 'Got expected content type')

    const text = await response.text()

    t.equal(text, TEST_DATA, 'Got expected file content')
  } finally {
    try {
      if (ipfs) await ipfs.stop()
    } catch (e) {
      console.error('Could not stop', e)
      // Whatever
    }
  }
})

test('Load a file from just the CID', async (t) => {
  let ipfs = null
  try {
    ipfs = await getInstance()

    const fetch = await makeIPFSFetch({ ipfs })

    t.pass('Able to make create fetch instance')

    const { cid } = await ipfs.add(TEST_DATA, { cidVersion: 1 })

    const response = await fetch(`ipfs://${cid}/`)

    t.ok(response, 'Got a response object')
    t.equal(response.status, 200, 'Got OK in response')

    const contentType = response.headers.get('Content-Type')
    t.equal(contentType, 'text/plain; charset=utf-8', 'Got expected content type')

    const text = await response.text()

    t.equal(text, TEST_DATA, 'Got expected file content')
  } finally {
    try {
      if (ipfs) await ipfs.stop()
    } catch (e) {
      console.error('Could not stop', e)
      // Whatever
    }
  }
})

test('Load a range from a file', async (t) => {
  let ipfs = null
  try {
    ipfs = await getInstance()

    const fetch = await makeIPFSFetch({ ipfs })

    t.pass('Able to make create fetch instance')

    const { cid } = await ipfs.add(TEST_DATA, { cidVersion: 1 })

    const response = await fetch(`ipfs://${cid}`, { headers: { Range: 'bytes=0-4' } })

    t.ok(response, 'Got a response object')
    t.equal(response.status, 206, 'Got partial response')

    const text = await response.text()

    t.equal(text, TEST_DATA.slice(0, 5), 'Got expected file content')
  } finally {
    try {
      if (ipfs) await ipfs.stop()
    } catch (e) {
      console.error('Could not stop', e)
      // Whatever
    }
  }
})

test('Get expected headers from HEAD', async (t) => {
  let ipfs = null
  try {
    ipfs = await getInstance()

    const fetch = await makeIPFSFetch({ ipfs })

    t.pass('Able to make create fetch instance')

    const { cid } = await ipfs.add(TEST_DATA, { cidVersion: 1 })

    const response = await fetch(`ipfs://${cid}`, { method: 'head' })

    t.ok(response, 'Got a response object')
    t.equal(response.status, 200, 'Got OK in response')

    const size = response.headers.get('Content-Length')
    t.equal(size, TEST_DATA.length.toString(), 'Got expected content length')
  } finally {
    try {
      if (ipfs) await ipfs.stop()
    } catch (e) {
      console.error('Could not stop', e)
      // Whatever
    }
  }
})

test('Load a directory listing via fetch', async (t) => {
  let ipfs = null
  try {
    ipfs = await getInstance()

    const fetch = await makeIPFSFetch({ ipfs })

    t.pass('Able to make create fetch instance')

    const results = await collect(ipfs.addAll([
      { path: '/example.txt', content: TEST_DATA },
      { path: '/example2.txt', content: TEST_DATA }
    ], { wrapWithDirectory: true }))

    // The last element should be the directory itself
    const { cid } = results[results.length - 1]

    const response = await fetch(`ipfs://${cid}/`, {
      headers: {
        Accept: 'text/html'
      }
    })

    t.ok(response, 'Got a response object')
    t.equal(response.status, 200, 'Got OK in response')

    const text = await response.text()

    t.ok(text, 'Got directory listing')
    t.ok(text.includes('example.txt'), 'Listing has first file')
    t.ok(text.includes('example2.txt'), 'Listing has second file')

    const jsonResponse = await fetch(`ipfs://${cid}/`)

    t.equal(jsonResponse.status, 200, 'Got OK in response')

    const files = await jsonResponse.json()

    t.deepEqual(files, ['example.txt', 'example2.txt'], 'Got files in JSON form')
  } finally {
    try {
      if (ipfs) await ipfs.stop()
    } catch (e) {
      console.error('Could not stop', e)
      // Whatever
    }
  }
})

test('Resolve index.html from a directory', async (t) => {
  let ipfs = null
  try {
    ipfs = await getInstance()

    const fetch = await makeIPFSFetch({ ipfs })

    t.pass('Able to make create fetch instance')

    const results = await collect(ipfs.addAll([
      { path: '/index.html', content: TEST_DATA, mode: 420 },
      { path: 'example/index.html', content: TEST_DATA, mode: 420 }
    ], { wrapWithDirectory: true, cidVersion: 1 }))

    // The last element should be the directory itself
    const { cid } = results[results.length - 1]

    const response = await fetch(`ipfs://${cid}/`)

    t.ok(response, 'Got a response object')
    t.equal(response.status, 200, 'Got OK in response')

    const text = await response.text()

    t.equal(text, TEST_DATA, 'Got index from directory')

    const rawResponse = await fetch(`ipfs://${cid}/?noResolve`)

    t.equal(rawResponse.status, 200, 'Got OK in response')

    const files = await rawResponse.json()

    t.deepEqual(files, ['example/', 'index.html'], 'Got files in JSON form')

    const subfolderResponse = await fetch(`ipfs://${cid}/example`)

    t.ok(subfolderResponse, 'Got a response object')
    t.equal(subfolderResponse.status, 200, 'Got OK in response')

    const text2 = await subfolderResponse.text()

    t.equal(text2, TEST_DATA, 'Got index from directory')
  } finally {
    try {
      if (ipfs) await ipfs.stop()
    } catch (e) {
      console.error('Could not stop', e)
      // Whatever
    }
  }
})

test('POST a file into IPFS', async (t) => {
  let ipfs = null
  try {
    ipfs = await getInstance()

    const fetch = await makeIPFSFetch({ ipfs })

    t.pass('Able to make create fetch instance')

    const response = await fetch('ipfs://example.txt/', {
      method: 'post',
      body: TEST_DATA
    })

    t.ok(response, 'Got a response object')
    t.equal(response.status, 200, 'Got OK in response')

    const ipfsUri = await response.text()
    t.match(ipfsUri, /^ipfs:\/\/\w+\/example.txt$/, 'returned IPFS url with CID')

    const fileResponse = await fetch(ipfsUri)
    t.equal(fileResponse.status, 200, 'Got OK in response')

    const text = await fileResponse.text()
    t.equal(text, TEST_DATA, 'Able to load POSTed file')

    /**
    // MFS uses different CIDs?
    const { cid } = await ipfs.add({
      path: 'example.txt',
      content: TEST_DATA
    }, {
      cidVersion: 1,
      wrapWithDirectory: true
    })
    t.equal(ipfsUri.match(/ipfs:\/\/([^/]+)/)[1], cid.toString('base32'), 'Matches cid from ipfs.add')
    **/
  } finally {
    try {
      if (ipfs) await ipfs.stop()
    } catch (e) {
      console.error('Could not stop', e)
      // Whatever
    }
  }
})

test('POST formdata to IPFS', async (t) => {
  let ipfs = null
  try {
    ipfs = await getInstance()

    const fetch = await makeIPFSFetch({ ipfs })

    t.pass('Able to make create fetch instance')

    const form = new FormData()

    form.append('file', TEST_DATA, {
      filename: 'example.txt'
    })

    form.append('file', TEST_DATA, {
      filename: 'example2.txt'
    })

    const body = form.getBuffer()
    const headers = form.getHeaders()

    const response = await fetch('ipfs:///', {
      method: 'post',
      headers,
      body
    })

    t.ok(response, 'Got a response object')
    t.equal(response.status, 200, 'Got OK in response')

    const ipfsUri = await response.text()
    t.match(ipfsUri, /ipfs:\/\/\w+\//, 'returned IPFS url with CID')

    const directoryResponse = await fetch(`${ipfsUri}?noResolve`)

    t.ok(directoryResponse.ok, 'Able to list directory')

    const files = await directoryResponse.json()

    t.deepEqual(files, ['example.txt', 'example2.txt'], 'Multiple files got uploaded')
  } finally {
    try {
      if (ipfs) await ipfs.stop()
    } catch (e) {
      console.error('Could not stop', e)
      // Whatever
    }
  }
})

test('POST to a CID', async (t) => {
  let ipfs = null
  try {
    ipfs = await getInstance()

    const fetch = await makeIPFSFetch({ ipfs })

    t.pass('Able to make create fetch instance')

    // Formerly 'ipfs:///example.txt`
    // Needed to change because a single filename gets interpreted as the hostname
    const response1 = await fetch('ipfs://example.txt/', {
      method: 'post',
      body: TEST_DATA
    })

    const firstURL = await response1.text()

    // Use different file name
    const response2 = await fetch(firstURL.replace('example.txt', 'example2.txt'), {
      method: 'post',
      body: TEST_DATA
    })

    t.equal(response2.status, 200, 'Got OK in response')

    const ipfsUri = await response2.text()
    t.match(ipfsUri, /^ipfs:\/\/\w+\/example2.txt$/, 'returned IPFS url with CID')

    const fileResponse = await fetch(ipfsUri)
    t.equal(fileResponse.status, 200, 'Got OK in response')

    const text = await fileResponse.text()
    t.equal(text, TEST_DATA, 'Able to load POSTed file')

    // Split out the file from the path
    const parentURI = ipfsUri.split('/').slice(0, -1).join('/') + '/'

    const dirResponse = await fetch(parentURI)

    const files = await dirResponse.json()

    t.deepEqual(files, ['example.txt', 'example2.txt'], 'Both files in CID directory')
  } finally {
    try {
      if (ipfs) await ipfs.stop()
    } catch (e) {
      console.error('Could not stop', e)
      // Whatever
    }
  }
})

test('Resolve IPNS', async (t) => {
  let ipfs = null
  try {
    ipfs = await getInstance()

    const fetch = await makeIPFSFetch({ ipfs })

    t.pass('Able to make create fetch instance')
    const dnsResponse = await fetch('ipns://ipfs.io/index.html')

    t.ok(dnsResponse.ok, 'Able to resolve ipfs.io')
  } finally {
    try {
      if (ipfs) await ipfs.stop()
    } catch (e) {
      console.error('Could not stop', e)
      // Whatever
    }
  }
})

test('Publish and resolve IPNS', async (t) => {
  let ipfs = null
  try {
    ipfs = await getInstance()

    const fetch = await makeIPFSFetch({ ipfs })

    t.pass('Able to make create fetch instance')

    const dataURI = await (await fetch('ipfs:///example.txt', { method: 'post', body: TEST_DATA })).text()
    const folderURI = dataURI.slice(0, -('example.txt'.length))

    const publishResponse = await fetch('ipns://post-file/', { method: 'post', body: folderURI })

    t.equal(publishResponse.status, 200, 'Got OK in response')

    const ipnsURI = await publishResponse.text()

    // base32 prefix is k https://github.com/multiformats/js-multibase/blob/ddd99e6d0d089d5d1209094f2e7a2a07d87729fb/src/constants.js#L43
    t.ok(ipnsURI.startsWith('ipns://b'), 'Got base32 encoded IPNS url')

    const resolvedResponse = await fetch(ipnsURI, {
      headers: {
        Accept: 'application/json'
      }
    })

    t.equal(resolvedResponse.status, 200, 'Got OK in response')

    const files = await resolvedResponse.json()
    t.deepEqual(files, ['example.txt'], 'resolved files')
  } finally {
    try {
      if (ipfs) await ipfs.stop()
    } catch (e) {
      console.error('Could not stop', e)
      // Whatever
    }
  }
})

test('POST FormData to IPNS', async (t) => {
  let ipfs = null
  try {
    ipfs = await getInstance()

    const fetch = await makeIPFSFetch({ ipfs })

    t.pass('Able to make create fetch instance')

    const form = new FormData()

    form.append('file', TEST_DATA, {
      filename: 'example.txt'
    })

    form.append('file', TEST_DATA, {
      filename: 'example2.txt'
    })

    const body = form.getBuffer()
    const headers = form.getHeaders()

    const response = await fetch('ipns://post-form/', {
      method: 'post',
      headers,
      body
    })

    t.ok(response, 'Got a response object')
    t.equal(response.status, 200, 'Got OK in response')

    const ipnsUri = await response.text()
    t.match(ipnsUri, /ipns:\/\/\w+\//, 'returned IPFS url with CID')

    const directoryResponse = await fetch(`${ipnsUri}?noResolve`)

    t.ok(directoryResponse.ok, 'Able to list directory')

    const files = await directoryResponse.json()

    t.deepEqual(files, ['example.txt', 'example2.txt'], 'Multiple files got uploaded')
  } finally {
    try {
      if (ipfs) await ipfs.stop()
    } catch (e) {
      console.error('Could not stop', e)
      // Whatever
    }
  }
})

test('POST file to update IPNS', async (t) => {
  let ipfs = null
  try {
    ipfs = await getInstance()

    const fetch = await makeIPFSFetch({ ipfs })

    t.pass('Able to make create fetch instance')

    const dataURI = await (await fetch('ipfs:///example.txt', { method: 'post', body: TEST_DATA })).text()
    const folderURI = dataURI.slice(0, -('example.txt'.length))

    const publishResponse = await fetch('ipns://update-file/', { method: 'post', body: folderURI })

    t.equal(publishResponse.status, 200, 'Got OK in response')

    const ipnsURI = await publishResponse.text()

    // base32 prefix is k https://github.com/multiformats/js-multibase/blob/ddd99e6d0d089d5d1209094f2e7a2a07d87729fb/src/constants.js#L43
    t.ok(ipnsURI.startsWith('ipns://b'), 'Got base32 encoded IPNS url')

    const postResponse = await fetch(ipnsURI + 'example2.txt', {
      method: 'POST',
      body: TEST_DATA
    })

    t.equal(postResponse.status, 200, 'Able to post to IPNS url with data')

    const ipnsURI2 = await postResponse.text()

    // base32 prefix is k https://github.com/multiformats/js-multibase/blob/ddd99e6d0d089d5d1209094f2e7a2a07d87729fb/src/constants.js#L43
    t.ok(ipnsURI2.startsWith('ipns://b'), 'Got base32 encoded IPNS url')

    const resolvedResponse = await fetch(ipnsURI, {
      headers: {
        Accept: 'application/json'
      }
    })

    t.equal(resolvedResponse.status, 200, 'Got OK in response')

    const files = await resolvedResponse.json()
    t.deepEqual(files, ['example.txt', 'example2.txt'], 'resolved files')
  } finally {
    try {
      if (ipfs) await ipfs.stop()
    } catch (e) {
      console.error('Could not stop', e)
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
