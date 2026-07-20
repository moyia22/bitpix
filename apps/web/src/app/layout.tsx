import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "BitPix", template: "%s · BitPix" },
  description: "Cobranças Pix simples para o balcão.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: "try{var t=localStorage.getItem('bitpix-theme');document.documentElement.classList.add(t==='dark'?'dark':'light')}catch(e){document.documentElement.classList.add('light')}",
          }}
        />
        <a className="skip-link" href="#conteudo-principal">Pular para o conteúdo</a>
        {children}
      </body>
    </html>
  );
}
