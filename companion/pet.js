(() => {
  'use strict';
  if (document.getElementById('site-static-character')) return;

  const assetRoot = new URL('.', document.currentScript?.src || location.href);
  const style = document.createElement('style');
  style.textContent = `
    #site-static-character{
      position:fixed;
      right:22px;
      bottom:18px;
      width:210px;
      height:330px;
      z-index:42;
      pointer-events:none;
      user-select:none;
      filter:drop-shadow(0 12px 15px rgba(31,48,39,.16));
    }
    #site-static-character img{
      display:block;
      width:100%;
      height:100%;
      object-fit:contain;
      object-position:center bottom;
    }
    @media(max-width:560px){
      #site-static-character{
        right:10px;
        bottom:12px;
        width:122px;
        height:192px;
      }
    }
  `;
  document.head.appendChild(style);

  const character = document.createElement('div');
  character.id = 'site-static-character';
  character.setAttribute('aria-hidden', 'true');
  character.innerHTML = `<img src="${new URL('girl.png', assetRoot).href}" alt="">`;
  document.body.appendChild(character);

  character.querySelector('img').addEventListener('error', () => character.remove());
})();
