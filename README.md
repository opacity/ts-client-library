# Opacity Client Library

## Packages

[`@opacity/opaque`](./packages/opaque) - Uploads and downloads

[`@opacity/account-system`](./packages/account-system) - Metadata

[`@opacity/middleware`](./packages/middleware) - Cryptography and network

[`@opacity/util`](./packages/util) - Utilities

## Example

Install
```sh
git submodule add -b dev https://github.com/opacity/ts-client-library.git
cd ts-client-library
npx lerna bootstrap
cd ..
```

src/index.ts
```ts
import { Upload, bindUploadToAccountSystem } from "../ts-client-library/packages/opaque"
import { AccountSystem, MetadataAccess } from "../ts-client-library/packages/account-system"
import { WebAccountMiddleware } from "../ts-client-library/packages/middleware/src/web/webAccountMiddleware"
import { WebNetworkMiddleware } from "../ts-client-library/packages/middleware/src/web/webNetworkMiddleware"
import { hexToBytes } from "../ts-client-library/packages/util/src/hex"
import { polyfillReadableStream } from "../ts-client-library/packages/util/src/streams"

const storageNode = "https://broker-1.opacitynodes.com:3000"

const accountHandle = hexToBytes("00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000")

const netMiddleware = new WebNetworkMiddleware()
const cryptoMiddleware = new WebAccountMiddleware({ asymmetricKey: accountHandle })

const metadataAccess = new MetadataAccess({
	net: netMiddleware,
	crypto: cryptoMiddleware,
	metadataNode: storageNode
})
const accountSystem = new AccountSystem({ metadataAccess })

const file = new File([new Blob(["hello world"], { type: "text/plain" })], "hello.txt")
const upload = new Upload({
	config: {
		crypto: cryptoMiddleware,
		net: netMiddleware,
		storageNode: storageNode,
	},
	meta: file,
	name: file.name,
	path: "/",
})

// side effects
bindUploadToAccountSystem(accountSystem, upload)

upload.start().then((output) => {
	if (output) {
		polyfillReadableStream<Uint8Array>(file.stream()).pipeThrough(output)
	}
})

upload.finish().then(() => {
	console.log("finish")

	accountSystem.getFilesInFolder("/").then((files) => {
		console.log(files)
	})
})
```
