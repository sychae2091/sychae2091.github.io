import { type CollectionEntry, getCollection } from 'astro:content';

export type Post = CollectionEntry<'blog'>;

export function tagsOf(post: Post): string[] {
	const tags = [...post.data.tags];
	if (post.id.startsWith('trend-') && !tags.includes('트렌드')) tags.unshift('트렌드');
	return tags;
}

export function readingMinutes(post: Post): number {
	const text = (post.body ?? '').replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`\-|[\]()]/g, ' ');
	const hangul = (text.match(/[가-힣]/g) ?? []).length;
	const words = text.replace(/[가-힣]/g, ' ').split(/\s+/).filter(Boolean).length;
	return Math.max(1, Math.round(hangul / 500 + words / 220));
}

export async function getPosts(): Promise<Post[]> {
	return (await getCollection('blog', (p) => !import.meta.env.PROD || !p.data.draft)).sort(
		(a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf(),
	);
}

export async function getAllTags(): Promise<{ tag: string; count: number }[]> {
	const counts = new Map<string, number>();
	for (const post of await getPosts()) {
		for (const tag of tagsOf(post)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
	}
	return [...counts.entries()]
		.map(([tag, count]) => ({ tag, count }))
		.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function formatDate(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `${y}.${m}.${d}`;
}

export function tagSlug(tag: string): string {
	return tag.toLowerCase().replace(/\s+/g, '-');
}

export function tagHref(tag: string): string {
	return `/tags/${encodeURIComponent(tagSlug(tag))}/`;
}
