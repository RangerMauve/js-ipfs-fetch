/* global FormData, Blob */
import crypto from 'crypto'
import { once } from 'events'

import test from 'tape'

import createEventSource from '@rangermauve/fetch-event-source'
import getPort from 'get-port'

import * as ipfsHttpModule from 'ipfs-http-client'
import * as Ctl from 'ipfsd-ctl'
import * as GoIPFS from 'go-ipfs'

import makeIPFSFetch from './index.js'

const ipfsBin = GoIPFS.path()

const EMPTY_DIR_URL = 'ipfs://bafyaabakaieac'
const TEST_DATA = 'Hello World!'
const TEST_DATA_BLOB = new Blob([TEST_DATA])

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
  const swarmPort = await getPort()
  const apiPort = await getPort()
  const ipfsOptions = {
    config: {
      Addresses: {
        API: `/ip4/127.0.0.1/tcp/${apiPort}`,
        Gateway: null,
        Swarm: [
          `/ip4/0.0.0.0/tcp/${swarmPort}`,
          `/ip6/::/tcp/${swarmPort}`,
          `/ip4/0.0.0.0/udp/${swarmPort}/quic`,
          `/ip6/::/udp/${swarmPort}/quic`
        ]
      },
      Ipns: {
        UsePubsub: true
      },
      Pubsub: {
        Enabled: true
      },
      Gateway: null
    }
  }

  const ipfsd = await factory.spawn({ ipfsOptions })

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
    t.ok(response.ok, 'Got OK in response')

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
    t.ok(response.ok, 'Got OK in response')

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
    t.ok(response.ok, 'Got OK in response')

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

test('Format string to get raw block', async (t) => {
  let ipfs = null
  try {
    ipfs = await getInstance()

    const fetch = await makeIPFSFetch({ ipfs })

    const expected = Buffer.from(TEST_DATA)

    const cid = await ipfs.block.put(expected)

    const url = `ipfs://${cid.toV1().toString()}/?format=raw`

    const response = await fetch(url)

    t.ok(response.ok, 'got ok in response')

    const gotRaw = await response.arrayBuffer()

    const gotBuffer = Buffer.from(gotRaw)

    t.ok(gotBuffer.equals(expected), 'Got raw block data')
  } finally {
    try {
      if (ipfs) await ipfs.stop()
    } catch (e) {
      console.error('Could not stop', e)
      // Whatever
    }
  }
})

test('Accept header to get raw block', async (t) => {
  let ipfs = null
  try {
    ipfs = await getInstance()

    const fetch = await makeIPFSFetch({ ipfs })

    const expected = Buffer.from(TEST_DATA)

    const cid = await ipfs.block.put(expected)

    const url = `ipfs://${cid.toV1().toString()}/`

    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.ipld.raw'
      }
    })

    t.ok(response.ok, 'got ok in response')

    const gotRaw = await response.arrayBuffer()

    const gotBuffer = Buffer.from(gotRaw)

    t.ok(gotBuffer.equals(expected), 'Got raw block data')
  } finally {
    try {
      if (ipfs) await ipfs.stop()
    } catch (e) {
      console.error('Could not stop', e)
      // Whatever
    }
  }
})

test('Format string to get car file', async (t) => {
  let ipfs = null
  try {
    ipfs = await getInstance()

    const fetch = await makeIPFSFetch({ ipfs })

    const cid = await ipfs.dag.put({ hello: 'world' })

    const expected = Buffer.concat(await collect(ipfs.dag.export(cid)))

    const url = `ipfs://${cid.toV1().toString()}/?format=car`

    const response = await fetch(url)

    t.ok(response.ok, 'got ok in response')

    const gotRaw = await response.arrayBuffer()

    const gotBuffer = Buffer.from(gotRaw)

    t.ok(gotBuffer.equals(expected), 'Got expected CAR file')
  } finally {
    try {
      if (ipfs) await ipfs.stop()
    } catch (e) {
      console.error('Could not stop', e)
      // Whatever
    }
  }
})

test('Accept header to get car file', async (t) => {
  let ipfs = null
  try {
    ipfs = await getInstance()

    const fetch = await makeIPFSFetch({ ipfs })

    const cid = await ipfs.dag.put({ hello: 'world' })

    const expected = Buffer.concat(await collect(ipfs.dag.export(cid)))

    const url = `ipfs://${cid.toV1().toString()}/`

    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.ipld.car'
      }
    })

    t.ok(response.ok, 'got ok in response')

    const gotRaw = await response.arrayBuffer()

    const gotBuffer = Buffer.from(gotRaw)

    t.ok(gotBuffer.equals(expected), 'Got expected CAR file')
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
    t.ok(response.ok, 'Got OK in response')

    const text = await response.text()

    t.ok(text, 'Got directory listing')
    t.ok(text.includes('example.txt'), 'Listing has first file')
    t.ok(text.includes('example2.txt'), 'Listing has second file')

    const jsonResponse = await fetch(`ipfs://${cid}/`)

    t.ok(jsonResponse.ok, 'Got OK in response')

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
    t.ok(response.ok, 'Got OK in response')

    const text = await response.text()

    t.equal(text, TEST_DATA, 'Got index from directory')

    const rawResponse = await fetch(`ipfs://${cid}/?noResolve`)

    t.ok(rawResponse.ok, 'Got OK in response')

    const files = await rawResponse.json()

    t.deepEqual(files, ['example/', 'index.html'], 'Got files in JSON form')

    const subfolderResponse = await fetch(`ipfs://${cid}/example`)

    t.ok(subfolderResponse, 'Got a response object')
    t.ok(subfolderResponse.ok, 'Got OK in response')

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

    const response = await fetch('ipfs://localhost/', {
      method: 'post',
      body: TEST_DATA
    })

    t.ok(response, 'Got a response object')
    t.ok(response.ok, 'Got OK in response')

    const ipfsUri = await response.text()
    t.match(ipfsUri, /^ipfs:\/\/\w+\/$/, 'returned IPFS url with CID')

    const fileResponse = await fetch(ipfsUri)
    t.ok(fileResponse.ok, 'Got OK in response')

    const text = await fileResponse.text()
    t.equal(text, TEST_DATA, 'Able to load POSTed file')
  } finally {
    try {
      if (ipfs) await ipfs.stop()
    } catch (e) {
      console.error('Could not stop', e)
      // Whatever
    }
  }
})

test('PUT a file and overwrite it', async (t) => {
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
    t.ok(response.ok, 'Got OK in response')

    const ipfsUri = response.headers.get('Location')
    t.match(ipfsUri, /^ipfs:\/\/\w+\/example.txt$/, 'returned IPFS url with CID')

    const fileResponse = await fetch(ipfsUri)
    t.ok(fileResponse.ok, 'Got OK in response')

    const text = await fileResponse.text()
    t.equal(text, TO_ADD, 'Able to load uploaded file')

    const REPLACE_WITH = 'Yup'

    const updateResponse = await fetch(ipfsUri, {
      method: 'put',
      body: REPLACE_WITH
    })

    t.ok(updateResponse.ok, 'Got OK in response')
    const updatedURL = updateResponse.headers.get('Location')
    t.match(updatedURL, /^ipfs:\/\/\w+\/example.txt$/, 'returned IPFS url with CID')

    const updatedFileResponse = await fetch(updatedURL)
    t.ok(updatedFileResponse.ok, 'Got OK in response')

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

test('PUT formdata to IPFS cid', async (t) => {
  let ipfs = null
  try {
    ipfs = await getInstance()

    const fetch = await makeIPFSFetch({ ipfs })

    t.pass('Able to make create fetch instance')

    const form = new FormData()

    form.append('file', new Blob([TEST_DATA]), 'example.txt')

    form.append('file', new Blob([TEST_DATA]), 'example2.txt')

    const response = await fetch(EMPTY_DIR_URL, {
      method: 'put',
      body: form
    })

    t.ok(response, 'Got a response object')
    t.ok(response.ok, 'Got OK in response')

    const ipfsUri = response.headers.get('Location')
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

test('POST formdata to IPFS localhost', async (t) => {
  let ipfs = null
  try {
    ipfs = await getInstance()

    const fetch = await makeIPFSFetch({ ipfs })

    t.pass('Able to make create fetch instance')

    const form = new FormData()

    form.append('file', new Blob([TEST_DATA]), 'example.txt')

    form.append('file', new Blob([TEST_DATA]), 'example2.txt')

    const response = await fetch('ipfs://localhost', {
      method: 'post',
      body: form
    })

    t.ok(response, 'Got a response object')
    t.ok(response.ok, 'Got OK in response')

    const ipfsUri = response.headers.get('Location')
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
    const response1 = await fetch(`${EMPTY_DIR_URL}/example.txt`, {
      method: 'PUT',
      body: TEST_DATA
    })

    await checkOk(response1)

    const firstURL = response1.headers.get('Location')

    // Use different file name
    const response2 = await fetch(firstURL.replace('example.txt', 'example2.txt'), {
      method: 'put',
      body: TEST_DATA
    })

    t.ok(response2.ok, 'Got OK in response')

    const ipfsUri = response2.headers.get('Location')
    t.match(ipfsUri, /^ipfs:\/\/\w+\/example2.txt$/, 'returned IPFS url with CID')

    const fileResponse = await fetch(ipfsUri)
    t.ok(fileResponse.ok, 'Got OK in response')

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

test('POST a CAR to localhost', async (t) => {
  let ipfs = null
  try {
    ipfs = await getInstance()

    const fetch = await makeIPFSFetch({ ipfs })

    const dagCID = await ipfs.dag.put({ hello: 'world' }, { storeCodec: 'dag-cbor' })

    const body = Buffer.concat(await collect(ipfs.dag.export(dagCID)))

    const response = await fetch('ipfs://localhost/', {
      headers: {
        'Content-Type': 'application/vnd.ipld.car'
      },
      method: 'POST',
      body
    })

    t.ok(response.ok, 'ok in response')

    const roots = (await response.text()).split('\n')

    const expectedURL = `ipfs://${dagCID.toV1().toString()}/`

    t.deepEqual(roots, [expectedURL], 'Got expected roots')
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

    const dataRequest = await fetch(`${EMPTY_DIR_URL}/example.txt`, {
      method: 'put',
      body: TEST_DATA
    })
    await checkOk(dataRequest)
    const dataURI = dataRequest.headers.get('Location')

    const folderURI = dataURI.slice(0, -('example.txt'.length))

    const makeKeyResponse = await fetch('ipns://localhost/?key=put-file', {
      method: 'POST'
    })

    t.ok(makeKeyResponse.ok, 'Got OK in response')

    const ipnsRoot = makeKeyResponse.headers.get('Location')

    t.ok(ipnsRoot.startsWith('ipns://k'), 'Got created base36 encoded IPNS URL')

    const publishResponse = await fetch(ipnsRoot, {
      method: 'post',
      body: folderURI
    })

    t.ok(publishResponse.ok, 'Got OK in response')

    const updatedURL = publishResponse.headers.get('Location')

    t.ok(updatedURL.startsWith('ipns://k'), 'Got base36 encoded IPNS url')
    t.equal(updatedURL, ipnsRoot, 'Got same public key after update')

    const resolvedResponse = await fetch(updatedURL, {
      headers: {
        Accept: 'application/json'
      }
    })

    t.ok(resolvedResponse.ok, 'Got OK in response')

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

    const makeKeyResponse = await fetch('ipns://localhost/?key=put-file', {
      method: 'POST'
    })

    t.ok(makeKeyResponse.ok, 'Got OK in response')

    const ipnsRoot = makeKeyResponse.headers.get('Location')

    const form = new FormData()

    form.append('file', TEST_DATA_BLOB, 'example.txt')

    form.append('file', TEST_DATA_BLOB, 'example2.txt')

    const response = await fetch(ipnsRoot, {
      method: 'PUT',
      body: form
    })

    t.ok(response.ok, 'Got OK in response')

    if (!response.ok) {
      throw new Error(await response.text())
    }

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

    const addResults = await collect(ipfs.addAll([
      { path: '/example.txt', content: TEST_DATA }
    ], { wrapWithDirectory: true, cidVersion: 1 }))

    // The last element should be the directory itself
    const { cid } = addResults.at(-1)
    const folderURI = `ipfs://${cid}/`

    const makeKeyResponse = await fetch('ipns://localhost/?key=update-file', {
      method: 'POST'
    })

    await checkOk(makeKeyResponse, 'Create IPNS URL', t)

    const ipnsRoot = makeKeyResponse.headers.get('Location')

    const publishResponse = await fetch(ipnsRoot, {
      method: 'post',
      body: folderURI
    })

    await checkOk(publishResponse, 'Able to post URL to IPNS', t)

    const updatedURI = publishResponse.headers.get('Location')

    t.equal(updatedURI, ipnsRoot, 'After updating, IPNS key stayed the same')

    const resolvedResponse1 = await fetch(ipnsRoot, {
      headers: {
        Accept: 'application/json'
      }
    })

    await checkOk(resolvedResponse1, 'Able to fetch IPNS data back')

    const file = await resolvedResponse1.json()
    t.deepEqual(file, ['example.txt'], 'resolved file')

    const putResponse = await fetch(ipnsRoot + 'example2.txt', {
      method: 'put',
      body: TEST_DATA
    })

    await checkOk(putResponse, 'Able to upload to IPNS url with data', t)

    const updatedURI2 = putResponse.headers.get('Location')

    t.equal(updatedURI2, ipnsRoot, 'After updating, IPNS key stayed the same')

    const resolvedResponse2 = await fetch(ipnsRoot, {
      headers: {
        Accept: 'application/json'
      }
    })

    await checkOk(resolvedResponse2, 'Able to fetch IPNS data back')

    const files = await resolvedResponse2.json()
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

    t.ok(deleteResponse.ok, 'Got OK in response')

    const url = deleteResponse.headers.get('Location')

    t.ok(url.startsWith('ipfs://b'), 'Got base32 encoded IPFS url')

    const directoryResponse = await fetch(url)

    t.ok(directoryResponse.ok, 'Able to GET new directory')

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
  // t.timeoutAfter(10000)
  let ipfs = null
  try {
    ipfs = await getInstance()

    const fetch = await makeIPFSFetch({ ipfs })

    t.pass('Able to make create fetch instance')
    const dnsResponse = await fetch('ipns://ipfs.tech/')

    t.ok(dnsResponse.ok, 'Able to resolve ipfs.tech')

    if (!dnsResponse.ok) {
      throw new Error(await dnsResponse.text())
    }
  } finally {
    try {
      if (ipfs) await ipfs.stop()
    } catch (e) {
      console.error('Could not stop', e)
      // Whatever
    }
  }
})

// Not sure what's up with this
test.skip('Testing the timeout option', async (t) => {
  let ipfs = null
  try {
    ipfs = await getInstance()

    const fetch = await makeIPFSFetch({ ipfs })

    t.pass('Able to make create fetch instance')

    const testTimeout = await fetch('ipfs://QmdKG3QikU5jTYiXuaQDLkbiYd5gfc7kdycYx6Axx6vvtt')

    t.ok(testTimeout, 'Got an error in response')
    t.equal(testTimeout.status, 408, 'Response is not OK')

    const contentTimeout = testTimeout.headers.get('Content-Type')
    t.equal(contentTimeout, null, 'Got expected content type')

    const textTimeout = (await testTimeout.text()).substring(0, 'TimeoutError:'.length)
    const TEST_DATA = 'TimeoutError:'

    t.equal(textTimeout, TEST_DATA, 'Got an error as a response')
  } finally {
    try {
      if (ipfs) await ipfs.stop()
    } catch (e) {
      console.error('Could not stop', e)
      // Whatever
    }
  }
})

test('Load IPLD dag node as JSON', async (t) => {
  let ipfs = null
  try {
    ipfs = await getInstance()

    const fetch = await makeIPFSFetch({ ipfs })

    const object = {
      hello: 'World!',
      nested: {
        object: 'property'
      }
    }

    const cid = await ipfs.dag.put(object, {
      storeCodec: 'dag-cbor'
    })

    const url = `ipld://${cid.toV1().toString()}/`

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json'
      }
    })

    t.ok(response.ok, 'able to fetch from CID')

    if (!response.ok) {
      throw new Error(await response.text())
    }

    const contentType = response.headers.get('Content-Type')

    t.equal(contentType, 'application/json', 'Content type is JSON')

    const data = await response.json()

    t.deepEqual(data, object, 'Resulting data same as uploaded')

    const subURL = new URL('/nested?format=dag-json', url).href

    const subResponse = await fetch(subURL)

    t.ok(subResponse.ok, 'able to fetch subpath from CID')

    if (!subResponse.ok) {
      throw new Error(await subResponse.text())
    }

    const subData = await subResponse.json()

    t.deepEqual(subData, object.nested, 'Got nested data out')
  } finally {
    try {
      if (ipfs) await ipfs.stop()
    } catch (e) {
      console.error('Could not stop', e)
      // Whatever
    }
  }
})

test('POST JSON to IPLD, have it saved to cbor', async (t) => {
  let ipfs = null
  try {
    ipfs = await getInstance()

    const fetch = await makeIPFSFetch({ ipfs })

    const object = {
      hello: 'World!',
      nested: {
        object: 'property'
      }
    }

    const url = 'ipld://localhost/?format=dag-cbor'

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(object)
    })

    t.ok(response.ok, 'able to post to IPLD')

    if (!response.ok) {
      throw new Error(await response.text())
    }

    const resultURL = response.headers.get('Location')
    const expectedURL = 'ipld://bafyreibemxbzlnhbiazvd5nb7u3lmflyourjzjvepwnojsirsx5z4iqm6q/'

    t.equal(resultURL, expectedURL, 'Got expected URL')
  } finally {
    try {
      if (ipfs) await ipfs.stop()
    } catch (e) {
      console.error('Could not stop', e)
      // Whatever
    }
  }
})

test('Patch IPLD object', async (t) => {
  let ipfs = null
  try {
    ipfs = await getInstance()

    const fetch = await makeIPFSFetch({ ipfs })

    const object = {
      hello: ['world']
    }

    const cid = await ipfs.dag.put(object, {
      storeCodec: 'dag-cbor'
    })

    const patches = [
      { op: 'add', path: '/hello/0', value: 'cruel' },
      { op: 'move', path: '/goodbye', from: '/hello' }
    ]

    const url = `ipld://${cid.toV1().toString()}/`

    const response = await fetch(url, {
      method: 'patch',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(patches)
    })

    await checkOk(response, 'Able to patch data', t)

    const updatedURL = response.headers.get('Location')

    const expectedURL = 'ipld://bafyreiaigmnxp4ehbvt4nptoof2w7dixyanblnq3lfvxslulsrzkcpk3ni/'

    t.equal(updatedURL, expectedURL, 'Got expected result URL')

    const updateResponse = await fetch(expectedURL + '?format=dag-json')

    await checkOk(updateResponse, 'Able to fetch updated data', t)

    const contentType = updateResponse.headers.get('Content-Type')

    t.equal(contentType, 'application/json', 'Content type is JSON')

    const data = await updateResponse.json()

    const expected = {
      goodbye: ['cruel', 'world']
    }

    t.deepEqual(data, expected, 'Patches got applied correctly')
  } finally {
    try {
      if (ipfs) await ipfs.stop()
    } catch (e) {
      console.error('Could not stop', e)
      // Whatever
    }
  }
})

test('pubsub between two peers', async (t) => {
  let ipfs1 = null
  let ipfs2 = null
  try {
    ipfs1 = await getInstance()
    ipfs2 = await getInstance()

    const fetch1 = await makeIPFSFetch({ ipfs: ipfs1 })
    const fetch2 = await makeIPFSFetch({ ipfs: ipfs2 })

    const { EventSource } = createEventSource(fetch1)

    const url = `pubsub://testing-${crypto.randomBytes(8).toString('hex')}/?format=utf8`

    const source = new EventSource(url)

    await Promise.race([
      once(source, 'open'),
      once(source, 'error').then((e) => { throw e })
    ])

    const toRead = Promise.race([
      once(source, 'message'),
      once(source, 'error').then((e) => { throw e })
    ])

    await delay(500)

    const message = 'Hello World!'

    const publishRequest = await fetch2(url, {
      method: 'POST',
      body: message
    })

    t.ok(publishRequest.ok, 'Able to send publish')

    if (!publishRequest.ok) {
      throw new Error(await publishRequest.text())
    }

    const [event] = await toRead

    const { data, lastEventId } = event
    t.ok(lastEventId, 'Got event id')

    const parsed = JSON.parse(data)

    t.equal(parsed.data, message, 'Expected message contents got sent')
  } finally {
    try {
      await Promise.all([
        ipfs1 ? ipfs1.stop() : null,
        ipfs2 ? ipfs1.stop() : null
      ])
    } catch (e) {
      console.error('Could not stop', e)
      // Whatever
    }
  }
})

async function delay (interval = 1000) {
  await new Promise((resolve) => setTimeout(resolve, interval))
}

async function collect (iterable) {
  const results = []
  for await (const item of iterable) {
    results.push(item)
  }

  return results
}

async function checkOk (response, message = 'HTTP Response', t = null) {
  if (!response.ok) throw new Error(`${message} Failed ${response.status}:\n${await response.text()}`)
  if (t) t.pass(message)
}
