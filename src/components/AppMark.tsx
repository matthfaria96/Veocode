/** Ícone do Veocode em tamanho pequeno (barra do topo). É o mesmo desenho de
 *  src-tauri/icons/source/veocode.svg, sem sombras e sem a margem de fora, para ficar nítido. */
export default function AppMark(props: { size?: number }) {
  const s = props.size ?? 22;
  return (
    <svg class="app-mark" width={s} height={s} viewBox="100 100 824 824" aria-hidden="true">
      <defs>
        <linearGradient id="vm-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#2a3160" />
          <stop offset="0.55" stop-color="#151a33" />
          <stop offset="1" stop-color="#0b0e1c" />
        </linearGradient>
        <linearGradient id="vm-back" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#5865e6" />
          <stop offset="1" stop-color="#3a43b0" />
        </linearGradient>
        <linearGradient id="vm-front" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#a3afff" />
          <stop offset="1" stop-color="#6874f0" />
        </linearGradient>
      </defs>
      <rect x="100" y="100" width="824" height="824" rx="186" fill="url(#vm-bg)" />
      <rect x="104" y="104" width="816" height="816" rx="182" fill="none" stroke="#fff" stroke-opacity="0.14" stroke-width="8" />
      <path d="M232 352 q0-48 48-48 h150 q26 0 42 20 l26 32 h246 q48 0 48 48 v330 q0 48-48 48 h-464 q-48 0-48-48 z" fill="url(#vm-back)" />
      <rect x="290" y="346" width="444" height="200" rx="26" fill="#eef0ff" />
      <path d="M232 470 q0-40 40-40 h480 q40 0 40 40 v264 q0 48-48 48 h-464 q-48 0-48-48 z" fill="url(#vm-front)" />
      <path d="M418 530 L512 690 L606 530" fill="none" stroke="#fff" stroke-width="72" stroke-linecap="round" stroke-linejoin="round" />
      <path transform="translate(700 226) scale(6)" d="M0 0 L0 22 L6 16.5 L10.5 26 L14.5 24.2 L10 14.8 L18 14.8 Z" fill="#e8915b" stroke="#fff" stroke-width="2.4" stroke-linejoin="round" />
    </svg>
  );
}
