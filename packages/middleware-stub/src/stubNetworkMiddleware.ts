import { NetworkMiddleware, NetworkMiddlewareResponse, NetworkMiddlewareMapReturn } from "@opacity/middleware"

const fetchAdapter = async <T = Uint8Array>(
	method: string,
	address: string,
	headers: HeadersInit,
	body: string | FormData | undefined,
	mapReturn: NetworkMiddlewareMapReturn<T> = async (b) => (b as unknown) as T,
): Promise<NetworkMiddlewareResponse<T>> => {
	await new Promise<void>((resolve) => {
		setTimeout(() => {
			resolve()
		}, 500 * Math.random() + 250)
	})

	return {
		headers: new Headers(),
		data: await mapReturn(new Response(new Uint8Array([])).body || undefined),
		ok: true,
		redirected: false,
		status: 200,
		statusText: "OK",
		url: address,
	}
}

export class StubNetworkMiddleware implements NetworkMiddleware {
	async GET<T> (
		address: string,
		headers: HeadersInit,
		body: undefined,
		mapReturn?: NetworkMiddlewareMapReturn<T>,
	): Promise<NetworkMiddlewareResponse<T>> {
		return await fetchAdapter("GET", address, headers, body, mapReturn)
	}

	async POST<T> (address: string, headers: HeadersInit, body: string, mapReturn?: NetworkMiddlewareMapReturn<T>) {
		return await fetchAdapter("POST", address, headers, body, mapReturn)
	}
}
