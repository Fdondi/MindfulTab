function createTimerWheel(config = {}) {
  const wheelElement = config.wheelElement;
  if (!wheelElement) {
    throw new Error("wheelElement is required");
  }

  const minMinutes = Math.max(1, Number(config.minMinutes || 1));
  const maxMinutes = Math.max(minMinutes, Number(config.maxMinutes || 120));
  const onChange = typeof config.onChange === "function" ? config.onChange : () => {};
  let selectedMinutes = Math.max(minMinutes, Math.min(maxMinutes, Number(config.initialMinutes || minMinutes)));

  function setSelected(nextMinutes, shouldScroll) {
    selectedMinutes = Math.max(minMinutes, Math.min(maxMinutes, Number(nextMinutes || minMinutes)));
    const options = Array.from(wheelElement.querySelectorAll(".timer-wheel-option"));
    for (const option of options) {
      const selected = Number(option.dataset.minutes) === selectedMinutes;
      option.classList.toggle("selected", selected);
      option.setAttribute("aria-selected", selected ? "true" : "false");
      if (selected && shouldScroll) {
        option.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }
    onChange(selectedMinutes);
  }

  function updateSelectedFromScroll() {
    const options = Array.from(wheelElement.querySelectorAll(".timer-wheel-option"));
    if (!options.length) return;
    const centerY = wheelElement.getBoundingClientRect().top + wheelElement.clientHeight / 2;
    let closest = options[0];
    let minDistance = Number.POSITIVE_INFINITY;

    for (const option of options) {
      const rect = option.getBoundingClientRect();
      const optionCenter = rect.top + rect.height / 2;
      const distance = Math.abs(optionCenter - centerY);
      if (distance < minDistance) {
        minDistance = distance;
        closest = option;
      }
    }

    setSelected(Number(closest.dataset.minutes), false);
  }

  wheelElement.innerHTML = "";
  for (let i = minMinutes; i <= maxMinutes; i += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "timer-wheel-option";
    button.dataset.minutes = String(i);
    button.role = "option";
    button.textContent = `${i} min`;
    button.addEventListener("click", () => setSelected(i, true));
    wheelElement.appendChild(button);
  }

  const onScroll = () => {
    window.requestAnimationFrame(updateSelectedFromScroll);
  };
  wheelElement.addEventListener("scroll", onScroll);
  setSelected(selectedMinutes, true);

  return {
    getMinutes() {
      return selectedMinutes;
    },
    setMinutes(minutes, shouldScroll = true) {
      setSelected(minutes, shouldScroll);
    },
    destroy() {
      wheelElement.removeEventListener("scroll", onScroll);
    }
  };
}

self.createTimerWheel = createTimerWheel;
