/** WebGL-движок Polish Studio: один фрагментный шейдер, всё офлайн */
export type Adjust = {
  exposure: number; contrast: number; highlights: number; shadows: number; whites: number; blacks: number;
  temperature: number; tint: number; vibrance: number; saturation: number;
  sharpness: number; clarity: number; smoothing: number; denoise: number;
  pop: number; vignette: number;
  hsl: [number, number, number][]; // 8 цветов × (тон, насыщенность, яркость), −100..100
};
export const HSL_COLORS = [["Красный", "#ef4444"], ["Оранжевый", "#f97316"], ["Жёлтый", "#eab308"], ["Зелёный", "#22c55e"], ["Голубой", "#06b6d4"], ["Синий", "#3b82f6"], ["Фиолетовый", "#8b5cf6"], ["Пурпурный", "#d946ef"]] as const;
export const neutral = (): Adjust => ({ exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, temperature: 0, tint: 0, vibrance: 0, saturation: 0, sharpness: 0, clarity: 0, smoothing: 0, denoise: 0, pop: 0, vignette: 0, hsl: Array.from({ length: 8 }, () => [0, 0, 0] as [number, number, number]) });
const p = (o: Partial<Adjust>): Adjust => ({ ...neutral(), ...o });
export const PRESETS: { id: string; name: string; adj: Adjust }[] = [
  { id: "viral", name: "Вирусный поп", adj: p({ exposure: 8, contrast: 28, highlights: -15, shadows: 20, vibrance: 45, saturation: 12, sharpness: 35, clarity: 25, pop: 40, vignette: -15 }) },
  { id: "darkdoc", name: "Тёмная документалистика", adj: p({ exposure: -10, contrast: 35, highlights: -25, shadows: -10, blacks: -20, temperature: -12, saturation: -35, clarity: 40, sharpness: 20, vignette: -45 }) },
  { id: "warm", name: "Тёплое кино", adj: p({ contrast: 12, highlights: -20, shadows: 15, temperature: 30, tint: 6, vibrance: 15, saturation: -5, blacks: 10, vignette: -25, hsl: [[0, 0, 0], [5, 15, 5], [0, 0, 0], [-10, -25, 0], [0, -20, 0], [-5, -15, 0], [0, 0, 0], [0, 0, 0]] }) },
  { id: "crisp", name: "Кристальная чёткость", adj: p({ exposure: 5, contrast: 18, whites: 15, blacks: -10, sharpness: 60, clarity: 45, denoise: 15, vibrance: 20 }) },
  { id: "dreamy", name: "Мечтательное свечение", adj: p({ exposure: 10, contrast: -15, highlights: 20, shadows: 25, temperature: 10, tint: 8, saturation: -10, vibrance: 10, smoothing: 45, clarity: -35, vignette: 20 }) },
];

const VS = `attribute vec2 p; varying vec2 uv; void main(){ uv = vec2((p.x+1.)/2., 1.-(p.y+1.)/2.); gl_Position = vec4(p,0.,1.); }`;
const FS = `precision highp float;
varying vec2 uv; uniform sampler2D t; uniform vec2 px;
uniform float exposure, contrast, highlights, shadows, whites, blacks, temperature, tint, vibrance, saturation, sharpness, clarity, smoothing, denoise, pop, vignette;
uniform vec3 hsl[8];
float lum(vec3 c){ return dot(c, vec3(.2126,.7152,.0722)); }
vec3 rgb2hsl(vec3 c){ float mx=max(c.r,max(c.g,c.b)), mn=min(c.r,min(c.g,c.b)); float l=(mx+mn)/2.; if(mx==mn) return vec3(0.,0.,l); float d=mx-mn; float s=l>.5? d/(2.-mx-mn): d/(mx+mn); float h; if(mx==c.r) h=(c.g-c.b)/d+(c.g<c.b?6.:0.); else if(mx==c.g) h=(c.b-c.r)/d+2.; else h=(c.r-c.g)/d+4.; return vec3(h/6.,s,l); }
float h2r(float p,float q,float t){ if(t<0.) t+=1.; if(t>1.) t-=1.; if(t<1./6.) return p+(q-p)*6.*t; if(t<.5) return q; if(t<2./3.) return p+(q-p)*(2./3.-t)*6.; return p; }
vec3 hsl2rgb(vec3 h){ if(h.y==0.) return vec3(h.z); float q=h.z<.5? h.z*(1.+h.y): h.z+h.y-h.z*h.y; float p=2.*h.z-q; return vec3(h2r(p,q,h.x+1./3.),h2r(p,q,h.x),h2r(p,q,h.x-1./3.)); }
vec3 blur(float r){ vec3 s=vec3(0.); for(int i=0;i<8;i++){ float a=float(i)*0.785398; s+=texture2D(t, uv+vec2(cos(a),sin(a))*px*r).rgb; } return s/8.; }
void main(){
  vec3 c = texture2D(t, uv).rgb;
  vec3 b1 = blur(1.5), b2 = blur(4.), b3 = blur(12.);
  // шумоподавление: подтягиваем к локальному среднему там, где разница мала
  float dn = denoise/100.; float diff = length(c-b1); c = mix(c, b1, dn*(1.-smoothstep(.02,.15,diff)));
  // сглаживание (кожа/шум) — мягкий блюр на неконтрастных зонах
  float sm = smoothing/100.; c = mix(c, (b1+b2)/2., sm*.8*(1.-smoothstep(.04,.25,length(c-b2))));
  // резкость (unsharp mask)
  c += (c-b1)*sharpness/100.*1.6;
  // чёткость / pop: локальный контраст на среднем радиусе с маской полутонов
  float L0 = lum(c); float mid = 1.-pow(abs(L0-.5)*2., 2.);
  c += (c-b3)*(clarity/100.*.9 + pop/100.*.6)*mid;
  // экспозиция
  c *= pow(2., exposure/100.*1.5);
  // белые/чёрные — уровни
  float bp = -blacks/100.*.15, wp = 1.-whites/100.*.2; c = (c-bp)/max(wp-bp,.05);
  // света/тени
  float L = lum(c); float sh = 1.-smoothstep(0.,.55,L), hi = smoothstep(.45,1.,L);
  c += c*sh*shadows/100.*.8 + sh*shadows/100.*.05; c += hi*highlights/100.*.35;
  // контраст (S-кривая вокруг 0.5) + pop
  float k = contrast/100. + pop/100.*.25; c = (c-.5)*(1.+k)+.5;
  // температура/оттенок
  c.r += temperature/100.*.12; c.b -= temperature/100.*.12; c.g -= tint/100.*.08; c.r += tint/100.*.03; c.b += tint/100.*.03;
  c = clamp(c, 0., 1.);
  // HSL по 8 цветам
  vec3 h = rgb2hsl(c); float cen[8]; cen[0]=0.; cen[1]=30.; cen[2]=60.; cen[3]=120.; cen[4]=180.; cen[5]=225.; cen[6]=275.; cen[7]=320.;
  vec3 acc = vec3(0.); float deg = h.x*360.;
  for(int i=0;i<8;i++){ float d = abs(deg-cen[i]); d = min(d, 360.-d); float w = (1.-smoothstep(0., 45., d)) * smoothstep(0.,.15,h.y); acc += hsl[i]/100.*w; }
  h.x = fract(h.x + acc.x*30./360. + 1.); h.y = clamp(h.y*(1.+acc.y), 0., 1.); h.z = clamp(h.z + acc.z*.25*h.y, 0., 1.);
  c = hsl2rgb(h);
  // насыщенность + сочность (защищает уже насыщенные)
  float g = lum(c); float sat = max(c.r,max(c.g,c.b))-min(c.r,min(c.g,c.b));
  float v = (vibrance/100. + pop/100.*.35)*(1.-sat);
  c = mix(vec3(g), c, 1.+saturation/100.+v);
  // виньетка
  vec2 q = uv-.5; q.x *= 1.777; float vg = smoothstep(.35, 1.05, length(q));
  c *= 1.+vignette/100.*vg*.85;
  gl_FragColor = vec4(clamp(c,0.,1.), 1.);
}`;

export class PolishGl {
  gl: WebGLRenderingContext; prog: WebGLProgram; tex: WebGLTexture; u: Record<string, WebGLUniformLocation | null> = {};
  constructor(public canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl", { preserveDrawingBuffer: true, premultipliedAlpha: false });
    if (!gl) throw new Error("WebGL недоступен в этом браузере");
    this.gl = gl;
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader"); return s; };
    const prog = gl.createProgram()!; gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link");
    this.prog = prog; gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.tex = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, this.tex);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    for (const n of ["t", "px", "hsl", ...Object.keys(neutral()).filter((k) => k !== "hsl")]) this.u[n] = gl.getUniformLocation(prog, n);
  }
  setImage(src: TexImageSource, w: number, h: number) {
    const gl = this.gl; this.canvas.width = w; this.canvas.height = h; gl.viewport(0, 0, w, h);
    gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.uniform2f(this.u.px, 1 / w, 1 / h); gl.uniform1i(this.u.t, 0);
  }
  render(a: Adjust) {
    const gl = this.gl;
    for (const [k, v] of Object.entries(a)) if (k !== "hsl") gl.uniform1f(this.u[k], v as number);
    gl.uniform3fv(this.u.hsl, new Float32Array(a.hsl.flat()));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

/** Приводит картинку к 1280×720 (cover) */
export function toCanvas1280(img: HTMLImageElement) {
  const c = document.createElement("canvas"); c.width = 1280; c.height = 720;
  const s = Math.max(1280 / img.naturalWidth, 720 / img.naturalHeight), w = img.naturalWidth * s, h = img.naturalHeight * s;
  c.getContext("2d")!.drawImage(img, (1280 - w) / 2, (720 - h) / 2, w, h);
  return c;
}
/** JPEG ≤ 2 МБ (лимит YouTube) или PNG */
export async function exportBlob(canvas: HTMLCanvasElement, type: "jpeg" | "png") {
  const get = (q?: number) => new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), `image/${type}`, q));
  if (type === "png") return get();
  for (const q of [0.92, 0.85, 0.78, 0.7, 0.6]) { const b = await get(q); if (b.size <= 2 * 1024 * 1024) return b; }
  return get(0.5);
}
export const download = (b: Blob, name: string) => { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
