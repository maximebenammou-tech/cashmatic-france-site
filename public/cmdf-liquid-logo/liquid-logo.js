/*!
 * Logo CMDF « métal liquide »
 * Shader adapté de « Liquid Logo » de Paper Design (licence MIT) :
 * https://github.com/paper-design/liquid-logo
 *
 * Utilisation :
 *   <div class="cmdf-liquid-logo" data-cmdf-liquid-logo data-tint="blue">
 *     <img src="/cmdf-liquid-logo/fallback-blue.png" alt="Cashmatic Distribution France">
 *   </div>
 *   <script src="/cmdf-liquid-logo/liquid-logo.js" defer></script>
 *
 * Options (attributs data-) :
 *   data-tint   "blue" (fonds sombres, défaut), "blue-light" (fonds clairs), "silver",
 *               ou "auto" : suit le mode clair/sombre du site
 *   data-speed  vitesse de l'animation, 0 à 1 (défaut 0.3)
 *   data-relief chemin de la carte de relief (défaut : relief-emblem.png à côté du script)
 *
 * Sans WebGL2, l'image de secours reste affichée. Si le visiteur a demandé
 * à réduire les animations, le logo reste figé. L'animation se met en pause
 * quand le logo sort de l'écran.
 */
(() => {
  const SCRIPT_DIR = (document.currentScript && document.currentScript.src.replace(/[^/]*$/, '')) || '';

  const VERT = `#version 300 es
precision mediump float;
in vec2 a_position; out vec2 vUv;
void main(){ vUv = .5 * (a_position + 1.); gl_Position = vec4(a_position, 0., 1.); }`;

  const FRAG = `#version 300 es
precision mediump float;
in vec2 vUv; out vec4 fragColor;
uniform sampler2D u_image_texture;
uniform float u_time, u_patternScale, u_refraction, u_edge, u_patternBlur, u_liquid, u_tint;
#define PI 3.14159265358979323846
vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec2 mod289(vec2 x){return x-floor(x*(1./289.))*289.;}
vec3 permute(vec3 x){return mod289(((x*34.)+1.)*x);}
float snoise(vec2 v){
  const vec4 C=vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);
  vec2 i=floor(v+dot(v,C.yy)); vec2 x0=v-i+dot(i,C.xx);
  vec2 i1=(x0.x>x0.y)?vec2(1.,0.):vec2(0.,1.);
  vec4 x12=x0.xyxy+C.xxzz; x12.xy-=i1; i=mod289(i);
  vec3 p=permute(permute(i.y+vec3(0.,i1.y,1.))+i.x+vec3(0.,i1.x,1.));
  vec3 m=max(0.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.); m=m*m; m=m*m;
  vec3 x=2.*fract(p*C.www)-1.; vec3 h=abs(x)-0.5; vec3 ox=floor(x+0.5); vec3 a0=x-ox;
  m*=1.79284291400159-0.85373472095314*(a0*a0+h*h);
  vec3 g; g.x=a0.x*x0.x+h.x*x0.y; g.yz=a0.yz*x12.xz+h.yz*x12.yw;
  return 130.*dot(m,g);
}
vec2 rotate(vec2 uv,float th){return mat2(cos(th),sin(th),-sin(th),cos(th))*uv;}
float channel(float c1,float c2,float p,vec3 w,float extra_blur,float b){
  float ch=c2; float border; float blur=u_patternBlur+extra_blur;
  ch=mix(ch,c1,smoothstep(.0,blur,p));
  border=w[0]; ch=mix(ch,c2,smoothstep(border-blur,border+blur,p));
  b=smoothstep(.2,.8,b);
  border=w[0]+.4*(1.-b)*w[1]; ch=mix(ch,c1,smoothstep(border-blur,border+blur,p));
  border=w[0]+.5*(1.-b)*w[1]; ch=mix(ch,c2,smoothstep(border-blur,border+blur,p));
  border=w[0]+w[1]; ch=mix(ch,c1,smoothstep(border-blur,border+blur,p));
  float gt=(p-w[0]-w[1])/w[2];
  ch=mix(ch,mix(c1,c2,smoothstep(0.,1.,gt)),smoothstep(border-blur,border+blur,p));
  return ch;
}
float frame_alpha(vec2 uv,float f){
  return smoothstep(0.,f,uv.x)*smoothstep(1.,1.-f,uv.x)*smoothstep(0.,f,uv.y)*smoothstep(1.,1.-f,uv.y);
}
void main(){
  vec2 uv=vUv; uv.y=1.-uv.y;
  float diagonal=uv.x-uv.y; float t=.001*u_time;
  vec2 img_uv=vec2(vUv.x,1.-vUv.y);
  float edge=texture(u_image_texture,img_uv).r;
  // u_tint : 0 = argent, 1 = bleu (fonds sombres), 2 = bleu soutenu (fonds clairs)
  vec3 color1=mix(vec3(.98,.98,1.),vec3(.86,.91,1.),clamp(u_tint,0.,1.));
  vec3 color2=mix(vec3(.1,.1,.1+.1*smoothstep(.7,1.3,uv.x+uv.y)),vec3(.09,.16,.38),clamp(u_tint,0.,1.));
  color1=mix(color1,vec3(.55,.64,.93),clamp(u_tint-1.,0.,1.));
  color2=mix(color2,vec3(.07,.13,.42),clamp(u_tint-1.,0.,1.));
  vec2 grad_uv=uv-.5;
  float dist=length(grad_uv+vec2(0.,.2*diagonal));
  grad_uv=rotate(grad_uv,(.25-.2*diagonal)*PI);
  float bulge=1.-pow(1.8*dist,1.2); bulge*=pow(uv.y,.3);
  float cw=u_patternScale;
  float r1=.12/cw*(1.-.4*bulge), r2=.07/cw*(1.+.4*bulge);
  float opacity=1.-smoothstep(.9-.5*u_edge,1.-.5*u_edge,edge);
  opacity*=frame_alpha(img_uv,0.01);
  float noise=snoise(uv-t);
  edge+=(1.-edge)*u_liquid*noise;
  float refr=clamp(1.-bulge,0.,1.);
  float dir=grad_uv.x+diagonal;
  dir-=2.*noise*diagonal*(smoothstep(0.,1.,edge)*smoothstep(1.,0.,edge));
  bulge*=clamp(pow(uv.y,.1),.3,1.);
  dir*=(.1+(1.1-edge)*bulge);
  dir*=smoothstep(1.,.7,edge);
  dir+=.18*(smoothstep(.1,.2,uv.y)*smoothstep(.4,.2,uv.y));
  dir+=.03*(smoothstep(.1,.2,1.-uv.y)*smoothstep(.4,.2,1.-uv.y));
  dir*=(.5+.5*pow(uv.y,2.));
  dir*=cw; dir-=t;
  float rr=refr+.03*bulge*noise; float rb=1.3*refr;
  rr+=5.*(smoothstep(-.1,.2,uv.y)*smoothstep(.5,.1,uv.y))*(smoothstep(.4,.6,bulge)*smoothstep(1.,.4,bulge));
  rr-=diagonal;
  rb+=(smoothstep(0.,.4,uv.y)*smoothstep(.8,.1,uv.y))*(smoothstep(.4,.6,bulge)*smoothstep(.8,.4,bulge));
  rb-=.2*edge;
  rr*=u_refraction; rb*=u_refraction;
  vec3 w=vec3(cw*r1,cw*r2,1.-r1-r2);
  w[1]-=.02*smoothstep(.0,1.,edge+bulge);
  float r=channel(color1.r,color2.r,mod(dir+rr,1.),w,0.02+.03*u_refraction*bulge,bulge);
  float g=channel(color1.g,color2.g,mod(dir,1.),w,0.01/(1.-diagonal),bulge);
  float b=channel(color1.b,color2.b,mod(dir-rb,1.),w,.01,bulge);
  fragColor=vec4(vec3(r,g,b)*opacity,opacity);
}`;

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  function mount(host) {
    const fallback = host.querySelector('img');
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'display:block;width:100%;height:100%';
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true });
    if (!gl) return; // l'image de secours reste en place

    const compile = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    try {
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    } catch (e) { console.warn('[cmdf-liquid-logo]', e); return; }
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);
    const U = n => gl.getUniformLocation(prog, n);

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a_position');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    gl.uniform1f(U('u_patternScale'), 2);
    gl.uniform1f(U('u_refraction'), .015);
    gl.uniform1f(U('u_edge'), .4);
    gl.uniform1f(U('u_patternBlur'), .005);
    gl.uniform1f(U('u_liquid'), .07);
    // Teinte « auto » : bleu soutenu en mode clair, bleu lumineux en mode sombre
    // (suit data-theme sur <html> ou, à défaut, le réglage du système)
    const darkQuery = matchMedia('(prefers-color-scheme: dark)');
    const isDark = () => {
      const t = document.documentElement.dataset.theme;
      return t ? t === 'dark' : darkQuery.matches;
    };
    const applyTint = () => {
      const mode = host.dataset.tint || 'blue';
      const tint = { silver: 0, blue: 1, 'blue-light': 2 }[mode] ?? (isDark() ? 1 : 2); // "auto"
      gl.uniform1f(U('u_tint'), tint);
      if (fallback && mode === 'auto' && fallback.dataset.srcDark) {
        fallback.src = isDark() ? fallback.dataset.srcDark : fallback.dataset.srcLight || fallback.src;
      }
    };
    applyTint();
    if (host.dataset.tint === 'auto') {
      darkQuery.addEventListener?.('change', () => { applyTint(); draw(); });
      new MutationObserver(() => { applyTint(); draw(); })
        .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
    const speed = host.dataset.speed ? +host.dataset.speed : .3;

    const resize = () => {
      const px = Math.max(1, Math.round(host.clientWidth * Math.min(devicePixelRatio || 1, 2)));
      if (canvas.width !== px) { canvas.width = canvas.height = px; gl.viewport(0, 0, px, px); }
    };

    let time = 0, last = 0, visible = true, raf = 0;
    const draw = () => {
      gl.uniform1f(U('u_time'), time);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    const loop = now => {
      if (last) time += (now - last) * speed;
      last = now;
      draw();
      raf = requestAnimationFrame(loop);
    };
    const update = () => {
      cancelAnimationFrame(raf); last = 0;
      if (visible && !reduceMotion.matches) raf = requestAnimationFrame(loop);
      else draw(); // image figée
    };

    const img = new Image();
    img.onload = () => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.uniform1i(U('u_image_texture'), 0);

      host.appendChild(canvas);
      if (fallback) fallback.style.display = 'none';
      resize();
      new ResizeObserver(() => { resize(); if (!raf || reduceMotion.matches) draw(); }).observe(host);
      new IntersectionObserver(([e]) => { visible = e.isIntersecting; update(); }).observe(host);
      reduceMotion.addEventListener?.('change', update);
      update();
    };
    img.onerror = () => console.warn('[cmdf-liquid-logo] carte de relief introuvable');
    img.src = host.dataset.relief || SCRIPT_DIR + 'relief-emblem.png';
  }

  const init = () => document.querySelectorAll('[data-cmdf-liquid-logo]').forEach(mount);
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
