(function(){
  var header=document.querySelector('.site-header');
  var onScroll=function(){header.classList.toggle('scrolled',window.scrollY>8)};
  onScroll();window.addEventListener('scroll',onScroll,{passive:true});

  var burger=document.querySelector('.burger'),menu=document.getElementById('menu');
  function setMenu(open){burger.setAttribute('aria-expanded',open);burger.setAttribute('aria-label',open?'Fermer le menu':'Ouvrir le menu');menu.classList.toggle('open',open);document.body.style.overflow=open?'hidden':''}
  burger.addEventListener('click',function(){setMenu(burger.getAttribute('aria-expanded')!=='true')});
  menu.addEventListener('click',function(e){if(e.target.tagName==='A')setMenu(false)});
  document.addEventListener('keydown',function(e){if(e.key==='Escape')setMenu(false)});

  var els=document.querySelectorAll('.rv');
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(entries){entries.forEach(function(en){if(en.isIntersecting){en.target.classList.add('in');io.unobserve(en.target)}})},{threshold:0.12,rootMargin:'0px 0px -40px 0px'});
    els.forEach(function(el){io.observe(el)});
  } else els.forEach(function(el){el.classList.add('in')});

  var links=document.querySelectorAll('.nav-links a[href^="#"]');
  var secs=[].map.call(links,function(a){return document.querySelector(a.getAttribute('href'))});
  window.addEventListener('scroll',function(){
    var y=window.scrollY+120,cur=-1;
    secs.forEach(function(s,i){if(s&&s.offsetTop<=y)cur=i});
    links.forEach(function(a,i){if(i===cur)a.setAttribute('aria-current','true');else a.removeAttribute('aria-current')});
  },{passive:true});

  document.getElementById('y').textContent=new Date().getFullYear();

  // Number Ticker (Magic UI, port vanilla)
  var ticks=document.querySelectorAll('.tick');
  var fmt=new Intl.NumberFormat('fr-FR');
  var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function runTick(el){
    var to=+el.dataset.to,t0=null,dur=1600;
    function frame(t){if(!t0)t0=t;var k=Math.min(1,(t-t0)/dur),e=1-Math.pow(1-k,4);el.textContent=fmt.format(Math.round(to*e)).replace(/\u202f|\u00a0/g,' ');if(k<1)requestAnimationFrame(frame)}
    requestAnimationFrame(frame);
  }
  if(!reduce&&'IntersectionObserver' in window){
    ticks.forEach(function(el){el.textContent='0'});
    var tio=new IntersectionObserver(function(en){en.forEach(function(x){if(x.isIntersecting){runTick(x.target);tio.unobserve(x.target)}})},{threshold:0.6});
    ticks.forEach(function(el){tio.observe(el)});
  }

  // Animated Beam : un paiement à la fois (logiciel -> monnayeur -> caisse juste)
  var beam=document.getElementById('beam');
  if(beam){
    var svg=beam.querySelector('.beam-svg'),NS='http://www.w3.org/2000/svg';
    var hub=beam.querySelector('[data-hub]'),out=beam.querySelector('[data-out]');
    var froms=[].slice.call(beam.querySelectorAll('[data-from]'));
    var mk=function(cls){var p=document.createElementNS(NS,'path');p.setAttribute('class',cls);svg.appendChild(p);return p};
    var lines=froms.map(function(f){return {a:f,b:hub}}).concat([{a:hub,b:out}]);
    lines.forEach(function(l){l.base=mk('base')});
    lines.forEach(function(l){l.fl=mk('flow')});
    var pathD=function(a,b,c){
      var ax,ay,bx,by;
      if(b.left>=a.right-1){ax=a.right-c.left;ay=a.top+a.height/2-c.top;bx=b.left-c.left;by=b.top+b.height/2-c.top;var mx=(ax+bx)/2;return 'M'+ax+','+ay+' C'+mx+','+ay+' '+mx+','+by+' '+bx+','+by}
      ax=a.left+a.width/2-c.left;ay=a.bottom-c.top;bx=b.left+b.width/2-c.left;by=b.top-c.top;var my=(ay+by)/2;return 'M'+ax+','+ay+' C'+ax+','+my+' '+bx+','+my+' '+bx+','+by;
    };
    var layout=function(){
      var c=beam.getBoundingClientRect();
      svg.setAttribute('viewBox','0 0 '+c.width+' '+c.height);
      lines.forEach(function(l){
        var d=pathD(l.a.getBoundingClientRect(),l.b.getBoundingClientRect(),c);
        l.base.setAttribute('d',d);l.fl.setAttribute('d',d);
        l.len=l.fl.getTotalLength();l.seg=Math.min(120,l.len*0.5);
        l.fl.style.strokeDasharray=l.seg+' '+(l.len+l.seg);l.fl.style.strokeDashoffset=l.seg;
      });
    };
    layout();window.addEventListener('resize',layout);
    if(document.fonts&&document.fonts.ready)document.fonts.ready.then(layout);
    if(!reduce&&svg.animate&&window.Promise){
      var visible=false,wake=null;
      var resume=function(){if(visible&&!document.hidden&&wake){var w=wake;wake=null;w()}};
      if('IntersectionObserver' in window){new IntersectionObserver(function(en){visible=en[0].isIntersecting;resume()},{threshold:0.2}).observe(beam)}else visible=true;
      document.addEventListener('visibilitychange',resume);
      var ready=function(){return visible&&!document.hidden?Promise.resolve():new Promise(function(r){wake=r})};
      var wait=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
      var run=function(l,col,dur){
        l.fl.style.stroke=col;l.base.classList.add('on');
        return l.fl.animate([{strokeDashoffset:l.seg+'px'},{strokeDashoffset:(-l.len)+'px'}],{duration:dur,easing:'cubic-bezier(.45,0,.25,1)'}).finished;
      };
      var outL=lines[lines.length-1],i=0;
      var cycle=function(){
        var node=froms[i],l=lines[i],col=node.getAttribute('data-color')||'#2E4FBF';
        return ready().then(function(){
          beam.style.setProperty('--beam-c',col);node.classList.add('is-on');
          return run(l,col,1100);
        }).then(function(){
          hub.classList.remove('pulse');void hub.offsetWidth;hub.classList.add('pulse');
          return wait(200);
        }).then(function(){return run(outL,col,850)}).then(function(){
          out.classList.add('is-ok');return wait(1000);
        }).then(function(){
          node.classList.remove('is-on');out.classList.remove('is-ok');l.base.classList.remove('on');outL.base.classList.remove('on');
          i=(i+1)%froms.length;return wait(350);
        }).then(cycle);
      };
      cycle();
    }
  }


  // Carrousel Réalisations (accueil)
  var rc=document.querySelector('[data-rc-root]');
  if(rc){
    var track=rc.querySelector('.rc-track'),btns=document.querySelectorAll('.rc-btn'),bar=document.querySelector('.rc-bar');
    var step=function(){var c=track.querySelector('.rc-card');return c?c.getBoundingClientRect().width+16:300};
    var sync=function(){
      var max=track.scrollWidth-track.clientWidth,x=track.scrollLeft;
      btns.forEach(function(b){b.disabled=+b.dataset.rc<0?x<=2:x>=max-2});
      if(bar){var w=Math.max(0.12,track.clientWidth/track.scrollWidth);bar.style.setProperty('--rc-w',(w*100)+'%');bar.style.setProperty('--rc-x',(max>0?x/max*(1-w)/w*100:0)+'%')}
    };
    btns.forEach(function(b){b.addEventListener('click',function(){track.scrollBy({left:+b.dataset.rc*step()*(window.innerWidth>1100?2:1),behavior:reduce?'auto':'smooth'})})});
    track.addEventListener('scroll',sync,{passive:true});window.addEventListener('resize',sync);sync();
  }

  var form=document.getElementById('quote');
  if(form){
  form.dataset.t=String(Date.now());
  if(/[?&]contact=envoye/.test(location.search)){var o=document.getElementById('form-ok');if(o)o.style.display='block'}
  var check=function(field){
    var input=field.querySelector('input,select,textarea');
    if(!input)return true;
    var ok=input.checkValidity();
    field.classList.toggle('invalid',!ok);
    input.setAttribute('aria-invalid',!ok);
    return ok;
  };
  form.querySelectorAll('.field').forEach(function(f){
    var i=f.querySelector('input,select,textarea');
    i.addEventListener('blur',function(){if(i.value)check(f)});
    i.addEventListener('input',function(){if(f.classList.contains('invalid'))check(f)});
  });
  form.addEventListener('submit',function(e){
    e.preventDefault();
    var fields=form.querySelectorAll('.field'),first=null;
    fields.forEach(function(f){if(!check(f)&&!first)first=f});
    if(first){first.querySelector('input,select,textarea').focus();return}
    var btn=form.querySelector('button[type="submit"]'),label=[].slice.call(btn.childNodes).map(function(n){return n.cloneNode(true)});
    var restore=function(){btn.disabled=false;btn.textContent='';label.forEach(function(n){btn.appendChild(n.cloneNode(true))})};
    var lien=function(href,txt){var a=document.createElement('a');a.href=href;a.textContent=txt;return a};
    var ok=document.getElementById('form-ok'),err=document.getElementById('form-err');
    ok.style.display='none';err.style.display='none';
    btn.disabled=true;btn.textContent='Envoi en cours…';
    var d=new URLSearchParams(new FormData(form));d.append('t',form.dataset.t||'');
    try{var q=new URLSearchParams(location.search);['utm_source','utm_medium','utm_campaign'].forEach(function(k){var v=q.get(k);if(v)d.append(k,v.slice(0,100))});var ref=document.referrer;if(ref&&ref.indexOf(location.origin)!==0)d.append('provenance',ref.slice(0,300))}catch(x){}
    function fail(msg){
      err.textContent='';
      err.append(msg||"L'envoi n'a pas abouti.",' Vous pouvez aussi nous écrire à ',lien('mailto:contact@cashmatic-france.fr','contact@cashmatic-france.fr'),' ou appeler le ',lien('tel:+33765745060','07 65 74 50 60'),'.');
      err.style.display='block';restore();
    }
    fetch(form.getAttribute('action'),{method:'POST',body:d,headers:{'Accept':'application/json'}})
      .then(function(r){return r.json().catch(function(){return {ok:false}}).then(function(j){return {status:r.status,j:j}})})
      .then(function(res){
        if(res.j&&res.j.ok){form.reset();form.querySelectorAll('.field').forEach(function(f){f.classList.remove('invalid')});ok.style.display='block';restore();ok.focus&&ok.setAttribute('tabindex','-1');ok.focus();}
        else fail(res.j&&res.j.message);
      })
      .catch(function(){fail()});
  });
  }
})();
