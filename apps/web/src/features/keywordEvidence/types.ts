export type KeywordInput={query:string;language:string;region:string};
export type KeywordSummary={videos:number;metadata:number;knownViews:number;medianViews:number|null;channels:number;knownSubscribers:number;hiddenChannels:number;medianSubscribers:number|null;smallChannels:number;titleMatches:number};
export type KeywordRow={position:number;id:string;title:string;channelId:string;channelTitle:string;publishedAt:string;metadata:boolean;views:number|null;subs:number|null;subscriberStatus:'known'|'hidden'|'missing'};
type Base={version:1;id:string;createdAt:string;input:KeywordInput};
export type KeywordEvidence=(Base&{kind:'suggestions';suggestions:string[];received:number;hasMore:boolean;summary:null})|(Base&{kind:'search';rows:KeywordRow[];hasMore:boolean;baseUnits:number;summary:KeywordSummary});
export type KeywordHistory={items:{id:string;kind:'suggestions'|'search';createdAt:string;query:string;count:number}[];skipped:number};
