let t=null,r=null;function f(){t=document.createElement("dialog"),t.className="confirm-dialog",t.innerHTML=`
    <div class="confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-text">
      <div class="confirm-icon" aria-hidden="true"></div>
      <h3 id="confirm-title"></h3>
      <p id="confirm-text"></p>
      <div class="confirm-actions">
        <button type="button" class="btn btn-outline" data-r="nao"></button>
        <button type="button" class="btn" data-r="sim"></button>
      </div>
    </div>`,document.body.append(t),t.addEventListener("click",e=>{const n=e.target.closest("[data-r]");if(n)return a(n.dataset.r==="sim");e.target===t&&a(!1)}),t.addEventListener("cancel",e=>{e.preventDefault(),a(!1)})}function a(e){if(!r)return;const n=r;r=null,t.close(),n(e)}function m({titulo:e,texto:n="",ok:l="Confirmar",cancelar:s="Cancelar",perigo:o=!1,icone:d=o?"🗑️":"❓"}){t||f(),a(!1),t.querySelector(".confirm-icon").textContent=d,t.querySelector(".confirm-icon").classList.toggle("danger",o),t.querySelector("#confirm-title").textContent=e;const i=t.querySelector("#confirm-text");i.textContent=n,i.hidden=!n;const c=t.querySelector('[data-r="sim"]');return c.textContent=l,c.classList.toggle("btn-danger",o),t.querySelector('[data-r="nao"]').textContent=s,document.activeElement?.blur?.(),new Promise(u=>{r=u,t.showModal(),t.querySelector('[data-r="nao"]').focus({focusVisible:!1})})}export{m as confirmar};
