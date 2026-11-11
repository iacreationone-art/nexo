let t=null,r=null;function m(){t=document.createElement("dialog"),t.className="confirm-dialog",t.innerHTML=`
    <div class="confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-text">
      <div class="confirm-icon" aria-hidden="true"></div>
      <h3 id="confirm-title"></h3>
      <p id="confirm-text"></p>
      <div class="confirm-actions">
        <button type="button" class="btn btn-outline" data-r="nao"></button>
        <button type="button" class="btn" data-r="sim"></button>
      </div>
    </div>`,document.body.append(t),t.addEventListener("click",e=>{const n=e.target.closest("[data-r]");if(n)return a(n.dataset.r==="sim");e.target===t&&a(!1)}),t.addEventListener("cancel",e=>{e.preventDefault(),a(!1)})}function a(e){if(!r)return;const n=r;r=null,t.close(),n(e)}function b({titulo:e,texto:n="",ok:d="Confirmar",cancelar:s="Cancelar",soAviso:i=!1,perigo:o=!1,icone:u=o?"🗑️":"❓"}){t||m(),a(!1),t.querySelector(".confirm-icon").textContent=u,t.querySelector(".confirm-icon").classList.toggle("danger",o),t.querySelector("#confirm-title").textContent=e;const c=t.querySelector("#confirm-text");c.textContent=n,c.hidden=!n;const l=t.querySelector('[data-r="sim"]');return l.textContent=d,l.classList.toggle("btn-danger",o),t.querySelector('[data-r="nao"]').textContent=s,t.querySelector('[data-r="nao"]').hidden=i,document.activeElement?.blur?.(),new Promise(f=>{r=f,t.showModal(),t.querySelector(i?'[data-r="sim"]':'[data-r="nao"]').focus({focusVisible:!1})})}export{b as confirmar};
