/** Ícone do Veocode em tamanho pequeno (barra do topo). É o mesmo desenho de
 *  src-tauri/icons/source/veocode.svg, sem sombras, brilhos e a margem de fora, para ficar nítido. */
export default function AppMark(props: { size?: number }) {
  const s = props.size ?? 22;
  return (
    <svg class="app-mark" width={s} height={s} viewBox="100 100 824 824" aria-hidden="true">
      <defs>
        <linearGradient id="vm-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#2f2878" />
          <stop offset="0.5" stop-color="#1a1448" />
          <stop offset="1" stop-color="#0c0926" />
        </linearGradient>
        <linearGradient id="vm-l" gradientUnits="userSpaceOnUse" x1="276" y1="300" x2="512" y2="742">
          <stop offset="0" stop-color="#a8f1ff" />
          <stop offset="0.55" stop-color="#4f9bff" />
          <stop offset="1" stop-color="#5b4dff" />
        </linearGradient>
        <linearGradient id="vm-r" gradientUnits="userSpaceOnUse" x1="748" y1="300" x2="512" y2="742">
          <stop offset="0" stop-color="#ffc27a" />
          <stop offset="0.55" stop-color="#ff7a7a" />
          <stop offset="1" stop-color="#d8479e" />
        </linearGradient>
      </defs>
      <path
        d="M627.4 100c103.8 0 155.8 0 195.4 20.2a185.4 185.4 0 0 1 81 81c20.2 39.7 20.2 91.6 20.2 195.4L924 627.4c0 103.8 0 155.8-20.2 195.4a185.4 185.4 0 0 1-81 81c-39.7 20.2-91.6 20.2-195.4 20.2L396.6 924c-103.8 0-155.8 0-195.4-20.2a185.4 185.4 0 0 1-81-81c-20.2-39.7-20.2-91.6-20.2-195.4L100 396.6c0-103.8 0-155.8 20.2-195.4a185.4 185.4 0 0 1 81-81c39.7-20.2 91.6-20.2 195.4-20.2Z"
        fill="url(#vm-bg)"
      />
      <path d="M298 300L399.1 300Q421.1 300 431.5 319.4L581.7 600.8Q584.5 606.1 581.7 611.4L528.6 711Q512 742 495.4 711L286.4 319.4Q276 300 298 300Z" fill="url(#vm-l)" />
      <path d="M624.9 300L726 300Q748 300 737.6 319.4L528.6 711Q512 742 495.4 711L442.3 611.4Q439.4 606.1 442.3 600.8L592.5 319.4Q602.9 300 624.9 300Z" fill="url(#vm-r)" />
      <path d="M516.7 479.1L582.7 602.6Q584.5 606.1 582.7 609.6L528.6 711Q512 742 495.4 711L441.3 609.6Q439.4 606.1 441.3 602.6L507.3 479.1Q512 470.2 516.7 479.1Z" fill="#f7f2ff" />
    </svg>
  );
}
