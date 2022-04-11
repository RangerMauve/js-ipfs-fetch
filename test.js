global.Buffer = Buffer

const test = require('tape')
const FormData = require('form-data')
const makeIPFSFetch = require('./')
const ipfsHttpModule = require('ipfs-http-client')

const Ctl = require('ipfsd-ctl')
const ipfsBin = require('go-ipfs').path()

const EMPTY_DIR_URL = 'ipfs://bafyaabakaieac'
const TEST_DATA = 'Hello World!'

const factory = Ctl.createFactory({
  type: 'go',
  // test: true,
  disposable: true,
  remote: false,
  ipfsHttpModule,
  ipfsBin,
  args: '--enable-namesys-pubsub'
})

test.onFinish(async () => {
  await factory.clean()
  // Used for browser tests
  if ((typeof window !== 'undefined') && window.close) window.close()
})

async function getInstance () {
  const ipfsd = await factory.spawn()
  await ipfsd.init()
  await ipfsd.start()
  await ipfsd.api.id()

  return ipfsd.api
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

// This should be deprecated?
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

test.only('PUT a file and overwrite it', async (t) => {
  let ipfs = null
  try {
    ipfs = await getInstance()

    const fetch = await makeIPFSFetch({ ipfs })

    t.pass('Able to make create fetch instance')

    const TO_ADD = 'This should be entirely replaced'

    const response = await fetch(`${EMPTY_DIR_URL}/example.txt`, {
      method: 'put',
      body: TO_ADD
    })

    t.ok(response, 'Got a response object')
    t.equal(response.status, 200, 'Got OK in response')

    const ipfsUri = await response.text()
    t.match(ipfsUri, /^ipfs:\/\/\w+\/example.txt$/, 'returned IPFS url with CID')

    const fileResponse = await fetch(ipfsUri)
    t.equal(fileResponse.status, 200, 'Got OK in response')

    const text = await fileResponse.text()
    t.equal(text, TO_ADD, 'Able to load uploaded file')

    const REPLACE_WITH = 'Yup'

    const updateResponse = await fetch(ipfsUri, {
      method: 'put',
      body: REPLACE_WITH
    })

    t.equal(updateResponse.status, 200, 'Got OK in response')
    const updatedURi = await updateResponse.text()
    t.match(updatedURi, /^ipfs:\/\/\w+\/example.txt$/, 'returned IPFS url with CID')

    const updatedFileResponse = await fetch(updatedURi)
    t.equal(updatedFileResponse.status, 200, 'Got OK in response')

    const updatedText = await updatedFileResponse.text()

    t.equal(updatedText, REPLACE_WITH, 'Fully replaced content')
  } finally {
    try {
      if (ipfs) await ipfs.stop()
    } catch (e) {
      console.error('Could not stop', e)
      // Whatever
    }
  }
})

test('PUT formdata to IPFS', async (t) => {
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

    const response = await fetch(EMPTY_DIR_URL, {
      method: 'put',
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

test('PUT to a CID', async (t) => {
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
      method: 'put',
      body: TEST_DATA
    })

    t.equal(response2.status, 200, 'Got OK in response')

    const ipfsUri = await response2.text()
    t.match(ipfsUri, /^ipfs:\/\/\w+\/example2.txt$/, 'returned IPFS url with CID')

    const fileResponse = await fetch(ipfsUri)
    t.equal(fileResponse.status, 200, 'Got OK in response')

    const text = await fileResponse.text()
    t.equal(text, TEST_DATA, 'Able to load uploaded file')

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

test('Publish and resolve IPNS', async (t) => {
  let ipfs = null
  try {
    ipfs = await getInstance()

    const fetch = await makeIPFSFetch({ ipfs })

    t.pass('Able to make create fetch instance')

    const dataURI = await (await fetch('ipfs:///example.txt', {
      method: 'post',
      body: TEST_DATA
    })).text()
    const folderURI = dataURI.slice(0, -('example.txt'.length))

    const publishResponse = await fetch('ipns://put-file/', {
      method: 'post',
      body: folderURI
    })

    t.equal(publishResponse.status, 200, 'Got OK in response')

    const ipnsURI = await publishResponse.text()

    t.ok(ipnsURI.startsWith('ipns://k'), 'Got base36 encoded IPNS url')

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

test('PUT FormData to IPNS', async (t) => {
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

    const response = await fetch('ipns://put-form/', {
      method: 'put',
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

test('PUT file to update IPNS', async (t) => {
  let ipfs = null
  try {
    ipfs = await getInstance()

    const fetch = await makeIPFSFetch({ ipfs })

    t.pass('Able to make create fetch instance')

    const dataURI = await (await fetch('ipfs:///example.txt', {
      method: 'post',
      body: TEST_DATA
    })).text()
    const folderURI = dataURI.slice(0, -('example.txt'.length))

    const publishResponse = await fetch('ipns://update-file/', {
      method: 'post',
      body: folderURI
    })

    t.equal(publishResponse.status, 200, 'Got OK in response')

    const ipnsURI = await publishResponse.text()

    t.ok(ipnsURI.startsWith('ipns://k'), 'Got base36 encoded IPNS url')

    const putResponse = await fetch(ipnsURI + 'example2.txt', {
      method: 'put',
      body: TEST_DATA
    })

    t.equal(putResponse.status, 200, 'Able to upload to IPNS url with data')

    const ipnsURI2 = await putResponse.text()

    t.ok(ipnsURI2.startsWith('ipns://k'), 'Got base36 encoded IPNS url')

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

test('DELETE from IPFS URL', async (t) => {
  let ipfs = null
  try {
    ipfs = await getInstance()

    const fetch = await makeIPFSFetch({ ipfs })

    t.pass('Able to make create fetch instance')

    const results = await collect(ipfs.addAll([
      { path: '/example.txt', content: TEST_DATA },
      { path: '/example2.txt', content: TEST_DATA }
    ], { wrapWithDirectory: true, cidVersion: 1 }))

    // The last element should be the directory itself
    const { cid } = results[results.length - 1]

    const deleteResponse = await fetch(`ipfs://${cid}/example.txt`, {
      method: 'DELETE'
    })

    t.equal(deleteResponse.status, 200, 'Got OK in response')

    const url = await deleteResponse.text()

    t.ok(url.startsWith('ipfs://b'), 'Got base32 encoded IPFS url')

    const directoryResponse = await fetch(url)

    t.equal(directoryResponse.status, 200, 'Able to GET new directory')

    const files = await directoryResponse.json()

    t.deepEqual(files, ['example2.txt'], 'File got deleted')
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
  t.timeoutAfter(6000)
  let ipfs = null
  try {
    ipfs = await getInstance()

    const fetch = await makeIPFSFetch({ ipfs })

    t.pass('Able to make create fetch instance')
    const dnsResponse = await fetch('ipns://ipfs.io/')

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

test('Testing the timeout option', async (t) => {
  let ipfs = null
  try {
    ipfs = await getInstance()

    const fetch = await makeIPFSFetch({ ipfs })

    t.pass('Able to make create fetch instance')

    const testTimeout = await fetch('ipfs://QmdKG3QikU5jTYiXuaQDLkbiYd5gfc7kdycYx6Axx6vvtt')

    t.ok(testTimeout, 'Got a response object')
    t.equal(testTimeout.status, 500, 'Got OK in response')

    const contentTimeout = testTimeout.headers.get('Content-Type')
    t.equal(contentTimeout, null, 'Got expected content type')

    const textTimeout = (await testTimeout.text()).substring(0, 'TimeoutError:'.length)
    const TEST_DATA = 'TimeoutError:'

    t.equal(textTimeout, TEST_DATA, 'Got expected response text')
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
