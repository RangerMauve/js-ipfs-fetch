# js-ipfs-fetch
Use the same `fetch()` API browsers provide for HTTP, but for IPFS


**Watch the intro video: [here](https://youtu.be/kI9Issf3MNc?t=1606)**

## Example

```javascript
const IPFS = require('ipfs-core')
const makeIpfsFetch = require('ipfs-fetch')

const ipfs = await IPFS.create()
const fetch = await makeIpfsFetch({ipfs})

const response = await fetch('ipfs://example CID here')
const text = await response.text()

console.log(text)
```

## JS API

### `const fetch = makeIPFSFetch({ipfs})`

The top level of the module exports a function to create instances of ipfs-fetch.

It takes an initialized `ipfs` instance which you can initialize somewhere in your code.

It will then return a `fetch()` function which conforms to [The Web API](https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/fetch), but with the twist that it supports `ipns://` and `ipfs://` URLs.

## Fetch API

### `await fetch('ipfs://CID/example.txt')`

If you specify a URL for a file (no trailing slashes), it will be loaded from IPFS and the content will be sent as the response body.

The response headers will contain a `Content-Length` header set to the size of the file.

### `await fetch('ipfs://CID/example/')`

If you specify a URL for a folder (has a trailing slash), the folder will be enumerated from IPFS and an HTML page listing its various files will be rendered.

Hyperlinks to files/folders will be automatically generated as relative URLs.

Links will have a trailing slash for folders.

If the folder contains an `index.html` it will be served as a file instead of performing a directory listing.

### `await fetch('ipfs://CID/example/', {headers: {'X-Resolve': none}})`

If you specify the `X-Resolve: none` header in your request, the resolution of `index.html` will be ignored and a directory listing will always be performed.

### `await fetch('ipfs://CID/example/', {headers: {Accept: 'application/json'}})`

If you specify a URL for a folder, and set the `Accept` header to only contain `application/json`, the directory will be enumerated and the list of files/folders will be returned as a JSON array.

You can get the file/folder list out of the response using `await response.json()`.

Names will have a trailing slash for folders.

### `await fetch('ipfs://CID/example.txt', {method: 'HEAD'})`

If you set the method to `HEAD`, it will be like doing a `GET` request but without actually loading data.

This is useful for getting the `Content-Length` or checking if a file exists.

### `await fetch('ipfs://CID/example.txt', { headers: { Range: 'bytes=0-4' })`

You can specify the `Range` header when making a request to load a subset of a file.

### `await fetch('ipfs://bafyaabakaieac/example.txt', {methhod: 'put', body: 'Hello World!'})`

You can upload files to IPFS by using `PUT` messages.

The response will contain a `Location` header with the created URL.
e.g. `const url = response.headers.get('Location')`

Note that `ipfs://bafyaabakaieac/` is a IPFS URL representing an empty directory (using an inline block definition).

### `await fetch('ipfs://bafyaabakaieac/', {method: 'put', body: new FormData()})`

You can upload several files to IPFS by using PUT messages with a [FormData](https://developer.mozilla.org/en-US/docs/Web/API/FormData) body.

You can [append](https://developer.mozilla.org/en-US/docs/Web/API/FormData) to a FormData with `formData.append(fieldname, content, 'filename.txt')` where `fieldname` gets ignored (use something like `file`?), the `content` can either be a String, Blob, or some sort of stream.
The `filename` will be the filename inside the IPFS directory that gets created.

The response will contain a `Location` header with the created URL.
e.g. `const url = response.headers.get('Location')`

Note that `ipfs://bafyaabakaieac/` is a IPFS URL representing an empty directory (using an inline definition).

### `await fetch('ipns://CID/example.txt')`

You can specify an IPNS URL to have it resolve to whatever resource you wanted using the Inter-Planetary Naming System

### `await fetch('ipns://localhost/?key=example_key', {method: 'POST'})`

You can create a new IPNS key using the `POST` method to the special `localhost` IPNS domain.

You must specify a custom "key name" in the `key` URL search parameter.

This name will be used to generate and keep track of an IPNS public key.

The response will contain a `Location` header which will have your `ipns://k2k4r...` public key URL.

Calling this method on an existing key will be a "no-op" and return a success regardless.

### `await fetch('ipns://localhost/?key=example_key')`

You can redirect to a `ipns://k2k4r...` public key URL by doing a GET on an existing key using the special `localhost` IPNS domain.

You must specify a custom "key name" in the `key` URL search parameter.

This will result in a `302` redirect with the URL being in the `Location` response header.

If you have not created this key before, a `404` response will be sent instead.

### `await fetch('ipns://localhost/?key=example_key', {method: 'DELETE'})`

You can delete an existing key using the `DELETE` method with the special `localhost` IPNS domain.

You must specify a custom "key name" in the `key` URL search parameter.

An error will be thrown if the key has not been created.

### `await fetch('ipns://PUBLIC_KEY/', {method: 'POST', body: 'ipfs://CID/example.txt'})`

You can publish to IPNS using the `POST` method.

The `body` should contain the `ipfs://` URL you want to point to.

The response will be an `ipns://` URL for your data.

It's best to point at directories when possible so that they can be treated as origins within browser contexts.

The key in the origin must be the public `ipns://k2k4r...` style key that you created with `ipns://localhost?key=`.

Please open a GitHub issue if you have ideas for how to do key import and export.

### `await fetch('ipns://PUBLIC_KEY/example.txt', {method: 'PUT', body: 'Hello World!'})`

You can update some data in an IPNS directory using the `PUT` method and a file path.

The `body` should be the contents of your file.

The key in the origin must be the public `ipns://k2k4r...` style key that you created with `ipns://localhost?key=`.

If this IPNS key has already had some data published under it, the CID for the directory will be fetched, and your file will be added on top.

This enables you to have mutable folders of data on top of IPFS+IPNS without having to juggle CIDs and merge data in your application.

### `await fetch('ipns://KEY_NAME/example', {method: 'PUT', body: new FormData()})`

You can upload several files to IPNS using the `POST` with a FormData body.

Similar to `ipfs` you can append serveral files and update an existing IPFS folder with your new data.

The key in the origin must be the public `ipns://k2k4r...` style key that you created with `ipns://localhost?key=`.

### `await fetch('ipld://CID/example', {method: 'GET', headers: {'Accept': "application/json"})`

You can get get raw [IPLD](https://ipld.io/) data from a CID using the `ipld` protocol scheme.

The data pointed to by the CID will not be interpreted as UnixFS and will use raw IPLD traversal wih the path.

Path segments can have custom parameters separated by `;` and can use URL encoding to have special characters like `/` represented.

The `Accept` header can be used to re-encode the data into a different format. Valid options right now are `application/json` or `application/vnd.ipld.dag-json` for dag-JSON encoding, and `application/vnd.ipld.dag-cbor` for CBOR encoding.

This lets you view IPLD data encoded as CBOR as JSON in your application without needing to decode it yourself.

### `await fetch('ipld://localhost?format=dag-cbor', {method: 'POST', body, {headers: {'Content-Type': "application/json"}})`

You can upload data to the IPLD data model by doing a `POST` to `ipfs://localhost`.

You can specify the encoding used for the body using the `Content-Type` header.
Data encoded in JSON will be encoded to the data model as dag-json.

You can also specify that you want the data to be saved in another format than what was used to upload it via the `?format` parameter.
Valid options are `dag-json` to save the body as JSON, and `dag-cbor` to save the body as CBOR.

This lets your application send data to IPLD authored in JSON, but have it saved to the more efficient CBOR encoding.

The resulting data will be returned in the `Location` header in the format of `ipld://CID/`.

### `new EventSource('pubsub://TOPIC/?format=base64') / fetch('pubsub://TOPIC/', {headers: {Accept: "text/event-stream"}})`

You can subscribe to [LibP2P's Publish/Subscribe](https://docs.libp2p.io/concepts/publish-subscribe/) topics when using the `pubsub` protocol, and using the `text/event-stream` Accept header.

If you have access to the Browser's [EventSource API](https://developer.mozilla.org/en-US/docs/Web/API/EventSource), or use something like [fetch-event-source](https://github.com/RangerMauve/fetch-event-source/) you can automatically parse the resulting events.
Otherwise you'll need to read from the response `body` and parse the stream body manually.

The `TOPIC` can be any utf-8 string and will be used to connect to peers from accross the network.

The EventSource will emit `message` events who'se `data` is a JSON object which contains the following parameters:
- `from`: the ID of the peer that sent the message
- `topics`: What topics the peer that sent this event is also gossiping on
- `data`: The encoded `data` for the message. By default it is a base64 encoded string.

The `?format` parameter can specify what format you expect messages `data` field to be encoded in.
The default is base64 which can be decoded with the browsers TextDecoder or [atob](https://developer.mozilla.org/en-US/docs/Web/API/atob) API.
Other options are `json` or `utf8`.
JSON is useful in that it won't require an extra decode step for structured data.

### `await fetch('pubsub://TOPIC/', {method: 'POST', data})`

You can publish a new message to subscribed peers for a `TOPIC` by doing a `POST` to the `pubsub` protocol.

The `TOPIC` can be any utf8 string and will be used to find peers on the network to send the data to.

The `body` will be sent as a binary buffer to all other peers and it'll be up to them to decode the data.
