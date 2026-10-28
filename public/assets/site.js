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

  // Animated Beam (Magic UI, port vanilla)
  var beam=document.getElementById('beam');
  if(beam){
    var svg=beam.querySelector('.beam-svg'),NS='http://www.w3.org/2000/svg';
    var hub=beam.querySelector('[data-hub]'),out=beam.querySelector('[data-out]');
    var froms=beam.querySelectorAll('[data-from]');
    var draw=function(){
      var c=beam.getBoundingClientRect();
      svg.setAttribute('viewBox','0 0 '+c.width+' '+c.height);
      while(svg.firstChild)svg.removeChild(svg.firstChild);
      var pairs=[].map.call(froms,function(f){return [f,hub]}).concat([[hub,out]]);
      pairs.forEach(function(pr,i){
        var a=pr[0].getBoundingClientRect(),b=pr[1].getBoundingClientRect();
        var horiz=b.left>=a.right-1,d,ax,ay,bx,by;
        if(horiz){ax=a.right-c.left;ay=a.top+a.height/2-c.top;bx=b.left-c.left;by=b.top+b.height/2-c.top}
        else{ax=a.left+a.width/2-c.left;ay=a.bottom-c.top;bx=b.left+b.width/2-c.left;by=b.top-c.top}
        if(horiz){var mx=(ax+bx)/2;d='M'+ax+','+ay+' C'+mx+','+ay+' '+mx+','+by+' '+bx+','+by}
        else{var my=(ay+by)/2;d='M'+ax+','+ay+' C'+ax+','+my+' '+bx+','+my+' '+bx+','+by}
        var base=document.createElementNS(NS,'path');base.setAttribute('d',d);base.setAttribute('class','base');svg.appendChild(base);
        var fl=document.createElementNS(NS,'path');fl.setAttribute('d',d);fl.setAttribute('class','flow');svg.appendChild(fl);
        var L=fl.getTotalLength(),seg=Math.min(70,L*0.35);
        fl.style.strokeDasharray=seg+' '+(L+seg);fl.style.strokeDashoffset=seg;
        if(!reduce&&fl.animate)fl.animate([{strokeDashoffset:seg+'px'},{strokeDashoffset:(-L)+'px'}],{duration:2400,delay:i===pairs.length-1?1400:i*350,iterations:Infinity,easing:'ease-in-out'});
      });
    };
    draw();window.addEventListener('resize',draw);
    if(document.fonts&&document.fonts.ready)document.fonts.ready.then(draw);
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
