# js-ipfs-fetch
Use the same `fetch()` API browsers provide for HTTP, but for IPFS

## Example

```javascript
const IPFS = require('ipfs')
const makeIpfsFetch = require('ipfs-fetch')

const ipfs = await IPFS.create()
const fetch = await makeIpfsFetch({ipfs})

const response = await fetch('ipfs://example CID here')
const text = await response.text()

console.log(text)
```
