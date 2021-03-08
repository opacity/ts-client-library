import { posix } from "path-browserify"
import Automerge from "automerge/src/automerge"

import { arraysEqual } from "@opacity/util/src/arrayEquality"
import { bytesToB64 } from "@opacity/util/src/b64"
import { cleanPath, isPathChild } from "@opacity/util/src/path"
import { MetadataAccess } from "./MetadataAccess"

export type FilesIndexEntry = {
	location: Uint8Array
	handle: Uint8Array
	finished: boolean
	folderDerive: Uint8Array
}

export type FilesIndex = { files: FilesIndexEntry[] }

export type FoldersIndexEntry = {
	location: Uint8Array
	path: string
}

export type FoldersIndex = { folders: FoldersIndexEntry[] }

export type FileCreationMetadata = {
	size: number
	dateModified: number
	type: string
}

export type FileMetadata = {
	location: Uint8Array
	handle: Uint8Array
	name: string
	path: string
	size: number
	uploaded: number
	modified: number
	type: string
}

export type FolderMetadata = {
	location: Uint8Array
	name: string
	path: string
	size: number
	uploaded: number
	modified: number
}

export class AccountSystemLengthError extends Error {
	constructor (item: string, min: number, max: number, recieved: number) {
		super(`AccountSystemLengthError: Invalid length of "${item}". Expected between ${min} and ${max}. Got ${recieved}.`)
	}
}

// export class AccountSystemAlreadyExistsError extends Error {
// 	constructor (type: string, path: string) {
// 		super(`AccountSystemAlreadyExistsError: ${type} "${path}" already exists`)
// 	}
// }

export class AccountSystemNotFoundError extends Error {
	constructor (type: string, path: string) {
		super(`AccountSystemNotFoundError: ${type} "${path}" not found`)
	}
}

export type AccountSystemArgs = {
	metadataAccess: MetadataAccess
}

export class AccountSystem {
	metadata: MetadataAccess

	guid = "5b7c0640-bc3a-4fa8-b588-ca6a922c1475"
	version = 2
	prefix = "/" + this.guid + "/v" + this.version

	indexes = {
		// preferences: this.prefix + "/preferences",
		files: this.prefix + "/files",
		folders: this.prefix + "/folders",
		// tags: this.prefix + "/tags",
		// share: this.prefix + "/share",
		// publicShare: this.prefix + "/public",
	}

	constructor ({ metadataAccess }: AccountSystemArgs) {
		this.metadata = metadataAccess
	}

	///////////////////////////////
	///////// Preferences /////////
	///////////////////////////////

	///////////////////////////////
	//////////// Files ////////////
	///////////////////////////////

	getFileDerivePath (location: Uint8Array): string {
		return this.prefix + "/file/" + bytesToB64(location)
	}

	async getFilesIndex (): Promise<Automerge.Doc<FilesIndex>> {
		const filesIndex =
			(await this.metadata.get<FilesIndex>(this.indexes.files)) || Automerge.from<FilesIndex>({ files: [] })

		// TODO: find orphans

		return filesIndex
	}

	async getFilesInFolder (path: string): Promise<Automerge.Doc<FilesIndexEntry[]>> {
		const filesIndex = await this.getFilesIndex()

		const foldersIndex = await this.getFoldersIndex()
		const folderEntry = foldersIndex.folders.find((f) => f.path == path)

		if (!folderEntry) {
			// TODO: orphan?
			throw new Error("unexpected")
		}

		return filesIndex.files.filter((f) =>
			arraysEqual(Object.values(f.folderDerive), Object.values(folderEntry.location)),
		)
	}

	async getFileMetadata (location: Uint8Array): Promise<Automerge.Doc<FileMetadata>> {
		const filePath = this.getFileDerivePath(location)

		const doc = await this.metadata.get<FileMetadata>(filePath)

		if (!doc) {
			throw new AccountSystemNotFoundError("file", filePath)
		}

		return doc
	}

	async addUpload (location: Uint8Array, key: Uint8Array, path: string, filename: string, meta: FileCreationMetadata) {
		path = cleanPath(path)

		for (let dir of path.split(posix.sep)) {
			// https://serverfault.com/questions/9546/filename-length-limits-on-linux
			if (dir.length > 255) {
				throw new AccountSystemLengthError(`directory ("${dir}" of "${path}")`, 1, 255, dir.length)
			}
		}

		// https://serverfault.com/questions/9546/filename-length-limits-on-linux
		if (filename.length > 255) {
			throw new AccountSystemLengthError(`filename ("${filename}")`, 1, 255, filename.length)
		}

		const folder = await this.addFolder(path)

		const handle = Uint8Array.from(Array.from(location).concat(Array.from(key)))
		const filePath = this.getFileDerivePath(location)

		await this.metadata.change<FilesIndex>(
			this.indexes.files,
			`Add file "${bytesToB64(location)}" to file index`,
			(doc) => {
				if (!doc.files) {
					doc.files = []
				}
				doc.files.push({
					location: location,
					handle: handle,
					folderDerive: Uint8Array.from(Object.values<number>(folder.location)),
					finished: false,
				})
			},
		)

		await this.metadata.change<FileMetadata>(filePath, `Init file metadata for "${bytesToB64(location)}"`, (doc) => {
			doc.location = location
			doc.handle = handle
			doc.name = filename
			doc.path = path
			doc.modified = meta.dateModified
			doc.size = meta.size
			doc.type = meta.type
			doc.uploaded = Date.now()
		})
	}

	async finishUpload (location: Uint8Array) {
		this.metadata.change<FilesIndex>(this.indexes.files, `Mark upload "${bytesToB64(location)}" finished`, (doc) => {
			const f = doc.files.find((file) => arraysEqual(file.location, location))

			if (!f) {
				// missing upload
				throw new AccountSystemNotFoundError("file", bytesToB64(location))
			}

			f.finished = true
		})
	}

	// async moveFile (location: Uint8Array) {}

	// async deleteFile (location: Uint8Array) {}

	///////////////////////////////
	/////////// Folders ///////////
	///////////////////////////////

	getFolderDerivePath (location: Uint8Array): string {
		return this.prefix + "/folder/" + bytesToB64(location)
	}

	async getFoldersIndex (): Promise<Automerge.Doc<FoldersIndex>> {
		const foldersIndex =
			(await this.metadata.get<FoldersIndex>(this.indexes.folders)) || Automerge.from<FoldersIndex>({ folders: [] })

		// TODO: find orphans

		const duplicates = new Set(foldersIndex.folders.map(({ path }) => path).filter((p, i, arr) => arr.indexOf(p) != i))

		// TODO: merge duplicate folders
		for (let dup of duplicates) {
		}

		return foldersIndex
	}

	async getFoldersInFolder (path: string): Promise<Automerge.Doc<FoldersIndexEntry[]>> {
		path = cleanPath(path)

		const foldersIndex = await this.getFoldersIndex()

		return foldersIndex.folders.filter((f) => isPathChild(path, f.path))
	}

	async getFolderMetadata (location: Uint8Array): Promise<Automerge.Doc<FolderMetadata>> {
		const folderPath = this.getFolderDerivePath(location)

		const doc = await this.metadata.get<FolderMetadata>(folderPath)

		if (!doc) {
			throw new AccountSystemNotFoundError("folder", folderPath)
		}

		return doc
	}

	async addFolder (path: string): Promise<Automerge.Doc<FolderMetadata>> {
		path = cleanPath(path)

		for (let dir of path.split(posix.sep)) {
			// https://serverfault.com/questions/9546/filename-length-limits-on-linux
			if (dir.length > 255) {
				throw new AccountSystemLengthError(`dir ("${dir}" of "${path}")`, 1, 255, dir.length)
			}
		}

		let foldersIndexDoc = await this.getFoldersIndex()

		const dup = foldersIndexDoc.folders.find((entry) => entry.path == path)

		if (dup) {
			return this.getFolderMetadata(Uint8Array.from(Object.values<number>(dup.location)))
		}

		const location = crypto.getRandomValues(new Uint8Array(32))
		const folderPath = this.getFolderDerivePath(location)

		await this.metadata.change<FoldersIndex>(this.indexes.folders, "Add folder to index", (doc) => {
			if (!doc.folders) {
				doc.folders = []
			}
			doc.folders.push({
				location: location,
				path,
			})
		})

		const doc = await this.metadata.change<FolderMetadata>(folderPath, "Init folder metadata", (doc) => {
			doc.location = location
			doc.name = posix.basename(path)
			doc.path = path
			doc.modified = Date.now()
			doc.size = 0
			doc.uploaded = Date.now()
		})

		return doc
	}

	// async moveFolder (oldPath: string, newPath: string) {}

	// async deleteFolder (path: string) {}

	///////////////////////////////
	//////////// Tags  ////////////
	///////////////////////////////

	///////////////////////////////
	//////////// Share ////////////
	///////////////////////////////

	///////////////////////////////
	/////////// Public  ///////////
	///////////////////////////////
}
