import type { APIRoute } from 'astro';
import { MONETIZATION } from '../consts';

export const GET: APIRoute = () => {
	const client = MONETIZATION.adsense.client;
	const body = client ? `google.com, ${client.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n` : '';
	return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
