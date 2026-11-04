import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
export type VisualStyle = { id:string; name:string; group:string; description:string; anchor:string; motion:string; negative:string; motionKind:"action"|"reveal"|"general"; source:string; revision:number; builtin:boolean };
export type StyleFields = Omit<VisualStyle,"id"|"revision"|"builtin">;
export const useVisualStyles = () => useQuery({ queryKey:["visual-styles"], queryFn:()=>api<VisualStyle[]>("/visual-styles"), staleTime:0, retry:false });
export const motionName = {action:"Сюжетное действие",reveal:"Рисование / появление",general:"Свободная анимация"};
