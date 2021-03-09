import { posix } from "path-browserify"
import { sha3_256 } from "js-sha3"

export const pathHash = (path: string) => {
	path = posix.normalize(path)

	let node = new Uint8Array(32)

	if (path) {
		var labels = path.split("/")

		for (var i = labels.length - 1; i >= 0; i--) {
			var labelSha = new Uint8Array(sha3_256.arrayBuffer(labels[i]))
			node = new Uint8Array(sha3_256.arrayBuffer(new Uint8Array(Array.from(node).concat(Array.from(labelSha)))))
		}
	}

	return node
}

export const hashToPath = (hash: Uint8Array): string => {
	if (hash.length % 2) {
		throw new Error("hash length must be multiple of two bytes")
	}

	return (
		"" + new Uint16Array(hash.buffer, hash.byteOffset, hash.byteLength / Uint16Array.BYTES_PER_ELEMENT).join("'/") + "'"
	)
}
