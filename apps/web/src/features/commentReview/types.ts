export type CommentRow={ref:string;id:string;text:string;truncated:boolean;likes:number|null;publishedAt:string|null};
export type CommentSample={version:1;id:string;createdAt:string;videoId:string;order:'relevance'|'time';limit:20|50;received:number;skipped:number;hasMore:boolean;rows:CommentRow[]};
export type CommentSelection={sampleId:string;language:string;focus:string};
export type CommentPreview={selection:CommentSelection;sample:CommentSample;system:string;user:string;hash:string};
export type CommentReview={version:1;id:string;createdAt:string;model:string;preview:CommentPreview;output:{summary:string;classifications:{ref:string;tone:'positive'|'neutral'|'negative'|'mixed'|'unclear'}[];themes:{kind:'request'|'praise'|'complaint'|'question'|'other';text:string;refs:string[]}[];ideas:{title:string;angle:string;why:string;refs:string[]}[]}};
export type CommentHistory={items:{id:string;createdAt:string;videoId:string;count:number;order?:string;model?:string}[];skipped:number};
