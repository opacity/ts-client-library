import { posix } from "path-browserify"
import Automerge from "automerge/src/automerge"

import { arraysEqual } from "@opacity/util/src/arrayEquality"
import { bytesToB64 } from "@opacity/util/src/b64"
import { cleanPath, isPathChild } from "@opacity/util/src/path"
import { MetadataAccess } from "./MetadataAccess"

export type FilesIndexEntry = {
	location: Uint8Array
	name: string
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
	lastModified: number
	type: string
}

export type FileMetadata = {
	location: Uint8Array
	handle: Uint8Array
	name: string
	path: string
	folderDerive: Uint8Array
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
		super(`AccountSystemLengthError: Invalid length of "${item}". Expected between ${min} and ${max}. Got ${recieved}`)
	}
}

export class AccountSystemAlreadyExistsError extends Error {
	constructor (type: string, path: string) {
		super(`AccountSystemAlreadyExistsError: ${type} "${path}" already exists`)
	}
}

export class AccountSystemSanitizationError extends Error {
	constructor (type: string, path: string, illegal: string[]) {
		super(
			`AccountSystemSanitizationError: ${type} "${path}" includes illegal characters "${illegal
				.map((s) => `"${s}"`)
				.join(", ")}"`,
		)
	}
}

export class AccountSystemNotFoundError extends Error {
	constructor (type: string, path: string) {
		super(`AccountSystemNotFoundError: ${type} "${path}" not found`)
	}
}

const validateFilename = (name: string) => {
	// https://serverfault.com/questions/9546/filename-length-limits-on-linux
	if (name.length < 1 || name.length > 255) {
		throw new AccountSystemLengthError(`filename ("${name}")`, 1, 255, name.length)
	}

	//https://stackoverflow.com/questions/457994/what-characters-should-be-restricted-from-a-unix-file-name
	if (name.includes(posix.sep) || name.includes("\0")) {
		throw new AccountSystemSanitizationError("file", name, [posix.sep, "\0"])
	}
}

const validateDirectoryPath = (path: string) => {
	if (path == "/") {
		return
	}

	for (let dir of path.split(posix.sep)) {
		try {
			validateFilename(dir)
		} catch (err) {
			if (err instanceof AccountSystemLengthError) {
				throw new AccountSystemLengthError(`directory ("${dir}" of "${path}")`, 1, 255, dir.length)
			}
			else if (err instanceof AccountSystemSanitizationError) {
				throw new AccountSystemSanitizationError("directory", dir, [posix.sep, "\0"])
			}
			else {
				throw err
			}
		}
	}
}

export type AccountSystemConfig = {
	metadataAccess: MetadataAccess
}

export class AccountSystem {
	config: AccountSystemConfig

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

	constructor (config: AccountSystemConfig) {
		this.config = config
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
			(await this.config.metadataAccess.get<FilesIndex>(this.indexes.files)) ||
			Automerge.from<FilesIndex>({ files: [] })

		// TODO: find orphans

		return filesIndex
	}

	async getFileIndexEntryByLocation (location: Uint8Array): Promise<Automerge.Doc<FilesIndexEntry>> {
		const filesIndex = await this.getFilesIndex()
		const fileEntry = filesIndex.files.find((file) => arraysEqual(file.location, location))

		if (!fileEntry) {
			// TODO: orphan?
			throw new AccountSystemNotFoundError("file", bytesToB64(location))
		}

		return fileEntry
	}

	async getFilesInFolder (path: string): Promise<Automerge.Doc<FilesIndexEntry[]>> {
		path = cleanPath(path)
		validateDirectoryPath(path)

		const filesIndex = await this.getFilesIndex()

		const folderEntry = await this.getFolderIndexEntryByPath(path)

		return filesIndex.files.filter((file) =>
			arraysEqual(Object.values(file.folderDerive), Object.values(folderEntry.location)),
		)
	}

	async getFileMetadata (location: Uint8Array): Promise<Automerge.Doc<FileMetadata>> {
		const filePath = this.getFileDerivePath(location)

		const doc = await this.config.metadataAccess.get<FileMetadata>(filePath)

		if (!doc) {
			throw new AccountSystemNotFoundError("file", filePath)
		}

		return doc
	}

	async addUpload (
		handle: Uint8Array,
		path: string,
		filename: string,
		meta: FileCreationMetadata,
	): Promise<Automerge.Doc<FileMetadata>> {
		path = cleanPath(path)
		validateDirectoryPath(path)
		validateFilename(filename)

		const folder = await this.addFolder(path)
		const folderDerive = new Uint8Array(Object.values<number>(folder.location))

		const location = await this.config.metadataAccess.config.crypto.getRandomValues(32)
		const filePath = this.getFileDerivePath(location)

		await this.config.metadataAccess.change<FilesIndex>(
			this.indexes.files,
			`Add file "${bytesToB64(location)}" to file index`,
			(doc) => {
				if (!doc.files) {
					doc.files = []
				}
				doc.files.push({
					location,
					name: filename,
					folderDerive,
					finished: false,
				})
			},
		)

		const file = await this.config.metadataAccess.change<FileMetadata>(
			filePath,
			`Init file metadata for "${bytesToB64(location)}"`,
			(doc) => {
				doc.location = location
				doc.handle = handle
				doc.name = filename
				doc.path = path
				doc.folderDerive = folderDerive
				doc.modified = meta.lastModified
				doc.size = meta.size
				doc.type = meta.type
				doc.uploaded = Date.now()
			},
		)

		return file
	}

	async finishUpload (location: Uint8Array): Promise<void> {
		await this.config.metadataAccess.change<FilesIndex>(
			this.indexes.files,
			`Mark upload "${bytesToB64(location)}" finished`,
			(doc) => {
				const f = doc.files.find((file) => arraysEqual(Object.values(file.location), location))

				if (!f) {
					// missing upload
					throw new AccountSystemNotFoundError("file", bytesToB64(location))
				}

				f.finished = true
			},
		)
	}

	async renameFile (location: Uint8Array, newName: string): Promise<Automerge.Doc<FileMetadata>> {
		validateFilename(newName)

		const fileIndexEntry = await this.getFileIndexEntryByLocation(location)
		if (!fileIndexEntry) {
			throw new AccountSystemNotFoundError("file", bytesToB64(location))
		}

		await this.config.metadataAccess.change<FilesIndex>(this.indexes.files, "Rename file", (doc) => {
			const fileIndexEntry = doc.files.find((file) => arraysEqual(Object.values(file.location), location))
			if (fileIndexEntry) {
				fileIndexEntry.name = newName
			}
		})

		const fileMeta = await this.config.metadataAccess.change<FileMetadata>(
			this.getFileDerivePath(new Uint8Array(Object.values<number>(fileIndexEntry.location))),
			"Rename file",
			(doc) => {
				doc.name = newName
			},
		)

		return fileMeta
	}

	async moveFile (location: Uint8Array, newPath: string): Promise<Automerge.Doc<FileMetadata>> {
		newPath = cleanPath(newPath)
		validateDirectoryPath(newPath)

		const folder = await this.addFolder(newPath)
		const folderDerive = new Uint8Array(Object.values<number>(folder.location))

		const fileIndexEntry = await this.getFileIndexEntryByLocation(location)
		if (!fileIndexEntry) {
			throw new AccountSystemNotFoundError("file", bytesToB64(location))
		}

		await this.config.metadataAccess.change<FilesIndex>(this.indexes.files, "Rename file", (doc) => {
			const fileIndexEntry = doc.files.find((file) => arraysEqual(Object.values(file.location), location))
			if (fileIndexEntry) {
				fileIndexEntry.folderDerive = folderDerive
			}
		})

		const fileMeta = await this.config.metadataAccess.change<FileMetadata>(
			this.getFileDerivePath(new Uint8Array(Object.values<number>(fileIndexEntry.location))),
			"Rename file",
			(doc) => {
				doc.path = newPath
				doc.folderDerive = folderDerive
			},
		)

		return fileMeta
	}

	// async deleteFile (location: Uint8Array) {}

	///////////////////////////////
	/////////// Folders ///////////
	///////////////////////////////

	getFolderDerivePath (location: Uint8Array): string {
		return this.prefix + "/folder/" + bytesToB64(location)
	}

	async getFoldersIndex (): Promise<Automerge.Doc<FoldersIndex>> {
		const foldersIndex =
			(await this.config.metadataAccess.get<FoldersIndex>(this.indexes.folders)) ||
			Automerge.from<FoldersIndex>({ folders: [] })

		// TODO: find orphans

		const duplicates = new Set(foldersIndex.folders.map(({ path }) => path).filter((p, i, arr) => arr.indexOf(p) != i))

		// TODO: merge duplicate folders
		for (let dup of duplicates) {
		}

		return foldersIndex
	}

	async getFolderIndexEntryByPath (path: string): Promise<Automerge.Doc<FoldersIndexEntry>> {
		path = cleanPath(path)
		validateDirectoryPath(path)

		const foldersIndex = await this.getFoldersIndex()
		const folderEntry = foldersIndex.folders.find((folder) => folder.path == path)

		if (!folderEntry) {
			// TODO: orphan?
			throw new AccountSystemNotFoundError("folder", path)
		}

		return folderEntry
	}

	async getFoldersInFolder (path: string): Promise<Automerge.Doc<FoldersIndexEntry[]>> {
		path = cleanPath(path)
		validateDirectoryPath(path)

		const foldersIndex = await this.getFoldersIndex()

		return foldersIndex.folders.filter((folder) => isPathChild(path, folder.path))
	}

	async getFolderMetadata (location: Uint8Array): Promise<Automerge.Doc<FolderMetadata>> {
		const folderPath = this.getFolderDerivePath(location)

		const doc = await this.config.metadataAccess.get<FolderMetadata>(folderPath)

		if (!doc) {
			throw new AccountSystemNotFoundError("folder", folderPath)
		}

		return doc
	}

	async addFolder (path: string): Promise<Automerge.Doc<FolderMetadata>> {
		path = cleanPath(path)
		validateDirectoryPath(path)

		let foldersIndexDoc = await this.getFoldersIndex()

		const dup = foldersIndexDoc.folders.find((entry) => entry.path == path)

		if (dup) {
			return this.getFolderMetadata(new Uint8Array(Object.values<number>(dup.location)))
		}

		const location = await this.config.metadataAccess.config.crypto.getRandomValues(32)
		const folderPath = this.getFolderDerivePath(location)

		await this.config.metadataAccess.change<FoldersIndex>(this.indexes.folders, "Add folder to index", (doc) => {
			if (!doc.folders) {
				doc.folders = []
			}
			doc.folders.push({
				location: location,
				path,
			})
		})

		const doc = await this.config.metadataAccess.change<FolderMetadata>(folderPath, "Init folder metadata", (doc) => {
			doc.location = location
			doc.name = posix.basename(path)
			doc.path = path
			doc.modified = Date.now()
			doc.size = 0
			doc.uploaded = Date.now()
		})

		return doc
	}

	async renameFolder (path: string, newName: string): Promise<Automerge.Doc<FolderMetadata>> {
		path = cleanPath(path)
		validateDirectoryPath(path)
		validateFilename(newName)

		return await this.moveFolder(path, posix.join(posix.dirname(path), newName))
	}

	async moveFolder (oldPath: string, newPath: string): Promise<Automerge.Doc<FolderMetadata>> {
		oldPath = cleanPath(oldPath)
		newPath = cleanPath(newPath)
		validateDirectoryPath(oldPath)
		validateDirectoryPath(newPath)

		const op = posix.dirname(oldPath) == posix.dirname(newPath) ? "Rename" : "Move"

		const newFolder = await this.getFolderIndexEntryByPath(newPath)
		if (newFolder) {
			throw new AccountSystemAlreadyExistsError("folder", newPath)
		}

		const folderIndexEntry = await this.getFolderIndexEntryByPath(oldPath)
		if (!folderIndexEntry) {
			throw new AccountSystemNotFoundError("folder", newPath)
		}

		await this.config.metadataAccess.change<FoldersIndex>(this.indexes.folders, `${op} folder`, (doc) => {
			const folderIndexEntry = doc.folders.find((folder) => folder.path == oldPath)
			if (folderIndexEntry) {
				folderIndexEntry.path = newPath
			}
		})

		const doc = await this.config.metadataAccess.change<FolderMetadata>(
			this.getFolderDerivePath(new Uint8Array(Object.values<number>(folderIndexEntry.location))),
			`${op} folder`,
			(doc) => {
				doc.name = posix.basename(newPath)
				doc.path = newPath
			},
		)

		return doc
	}

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
