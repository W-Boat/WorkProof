import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'WorkProof · 让创作过程，有据可查',description:'在你的浏览器中核验创作过程记录。作品不上传，证据可复核。'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>;}
