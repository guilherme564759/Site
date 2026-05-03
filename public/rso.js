document.querySelectorAll(".user-search").forEach((input) => {
  const targetId = input.dataset.target;
  const hidden = document.getElementById(targetId);
  const box = input.parentElement.querySelector(".suggest-box");
  let timer = null;

  input.addEventListener("input", () => {
    hidden.value = "";
    clearTimeout(timer);
    const q = input.value.trim();

    if (!q) {
      box.style.display = "none";
      box.innerHTML = "";
      return;
    }

    timer = setTimeout(async () => {
      const res = await fetch(`/api/usuarios?q=${encodeURIComponent(q)}`);
      const data = await res.json();

      box.innerHTML = "";
      if (!data.length) {
        box.innerHTML = `<div class="suggest-item">Nenhum usuário encontrado</div>`;
        box.style.display = "block";
        return;
      }

      data.forEach((user) => {
        const item = document.createElement("div");
        item.className = "suggest-item";
        const avatar = user.avatar ? `<img src="${user.avatar}">` : "";
        item.innerHTML = `${avatar}<div>${user.nome}<small>${user.patente || "Sem patente"} • ${user.unidade || "Sem unidade"}</small></div>`;
        item.addEventListener("click", () => {
          input.value = user.nome;
          hidden.value = user.id;
          box.style.display = "none";
        });
        box.appendChild(item);
      });

      box.style.display = "block";
    }, 180);
  });

  document.addEventListener("click", (e) => {
    if (!input.parentElement.contains(e.target)) {
      box.style.display = "none";
    }
  });
});

document.querySelector("form")?.addEventListener("submit", (e) => {
  document.querySelectorAll(".user-search[required]").forEach((input) => {
    const hidden = document.getElementById(input.dataset.target);
    if (!hidden.value) {
      e.preventDefault();
      alert("Selecione o policial correto na lista de sugestões.");
      input.focus();
    }
  });
});
