// Поддельный YouTube для тестов Радара: страницы поиска, канала, «похожих», подсказки,
// RSS (отдаёт 404, как сейчас настоящий) и превью. Структуры — как в ytInitialData.
import type { Fetcher } from "../../src/services/studio/ytweb.js";

export type FV = { id: string; title: string; ch: string; chName: string; views: number; len: string; age: string; verified?: boolean };
export type FC = { id: string; name: string; handle: string; subs: number | null; videos: FV[]; more?: boolean };
export type World = {
  search: Record<string, FV[]>; channels: FC[]; related: Record<string, FV[]>; suggest: Record<string, string[]>;
  /** true → YouTube отвечает 429 на этот адрес. */
  limited?: (url: string) => boolean;
  log: string[];
};
export const uc = (tag: string) => `UC${(tag + "x".repeat(22)).slice(0, 22)}`;
export const vid = (tag: string) => (tag + "_".repeat(11)).slice(0, 11);
const fmt = (n: number) => n >= 1e6 ? `${+(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}K` : String(n);

export const videoRenderer = (v: FV) => ({
  videoRenderer: {
    videoId: v.id, title: { runs: [{ text: v.title }] },
    ownerText: { runs: [{ text: v.chName, navigationEndpoint: { browseEndpoint: { browseId: v.ch } } }] },
    viewCountText: { simpleText: `${v.views.toLocaleString("en-US")} views` },
    lengthText: { simpleText: v.len }, publishedTimeText: { simpleText: v.age },
    ownerBadges: v.verified ? [{ metadataBadgeRenderer: { style: "BADGE_STYLE_TYPE_VERIFIED", tooltip: "Verified" } }] : [],
  },
});
export const lockup = (v: FV) => ({
  lockupViewModel: {
    contentId: v.id, contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
    contentImage: { thumbnailViewModel: { overlays: [{ thumbnailOverlayBadgeViewModel: { thumbnailBadges: [{ thumbnailBadgeViewModel: { text: v.len } }] } }] } },
    metadata: {
      lockupMetadataViewModel: {
        title: { content: v.title },
        image: { decoratedAvatarViewModel: { rendererContext: { commandContext: { onTap: { innertubeCommand: { browseEndpoint: { browseId: v.ch } } } } } } },
        metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: v.chName } }] }, { metadataParts: [{ text: { content: `${fmt(v.views)} views` } }, { text: { content: v.age } }] }] } },
      },
    },
  },
});
const page = (data: unknown) => `<!doctype html><html><script>var ytInitialData = ${JSON.stringify(data)};</script><script>ytcfg.set({"INNERTUBE_CLIENT_VERSION":"2.20261101.01.00"});</script></html>`;
const more = (token: string) => ({ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token } } } });
export const searchHtml = (items: unknown[], token?: string) => page({ contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: items } }, ...(token ? [more(token)] : [])] } } } } });
export const channelJson = (c: FC) => ({
  metadata: { channelMetadataRenderer: { externalId: c.id, title: c.name, vanityChannelUrl: `http://www.youtube.com/@${c.handle}` } },
  header: { pageHeaderRenderer: { content: { pageHeaderViewModel: { metadata: { contentMetadataViewModel: { metadataRows: [
    { metadataParts: [{ text: { content: `@${c.handle}` } }] },
    { metadataParts: [...(c.subs === null ? [] : [{ text: { content: `${fmt(c.subs)} subscribers` } }]), { text: { content: `${c.videos.length} videos` } }] },
  ] } } } } } },
  contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { title: "Videos", content: { richGridRenderer: { contents: [...c.videos.map((v) => ({ richItemRenderer: { content: videoRenderer(v) } })), ...(c.more ? [more("next-page")] : [])] } } } }] } },
});
export const watchHtml = (items: unknown[]) => page({ contents: { twoColumnWatchNextResults: { secondaryResults: { secondaryResults: { results: items } } } } });

const res = (status: number, body = "") => ({ status, text: async () => body });
export function fakeFetcher(w: World): Fetcher {
  return async (url, init) => {
    w.log.push(url);
    if (w.limited?.(url)) return res(429);
    const u = new URL(url);
    if (u.hostname === "suggestqueries.google.com") { const q = u.searchParams.get("q") ?? ""; return res(200, JSON.stringify([q, w.suggest[q] ?? []])); }
    if (u.hostname === "i.ytimg.com") return { status: 200, text: async () => "", arrayBuffer: async () => new Uint8Array(2000).buffer };
    if (u.pathname === "/results") return res(200, searchHtml((w.search[u.searchParams.get("search_query") ?? ""] ?? []).map(videoRenderer)));
    if (u.pathname === "/youtubei/v1/search") return res(200, "{}");
    if (u.pathname === "/youtubei/v1/browse") {
      const id = JSON.parse(String(init?.body ?? "{}")).browseId;
      const c = w.channels.find((x) => x.id === id);
      return c ? res(200, JSON.stringify(channelJson(c))) : res(404);
    }
    if (u.pathname === "/watch") return res(200, watchHtml((w.related[u.searchParams.get("v") ?? ""] ?? []).map(lockup)));
    if (u.pathname.startsWith("/feeds/")) return res(404);
    const m = /^\/(?:channel\/(UC[\w-]{22})|(@[^/]+))\/videos$/.exec(u.pathname);
    if (m) {
      const c = w.channels.find((x) => x.id === m[1] || `@${x.handle}` === decodeURIComponent(m[2] ?? ""));
      return c ? res(200, page(channelJson(c))) : res(404);
    }
    return res(404);
  };
}
