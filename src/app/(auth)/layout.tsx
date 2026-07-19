import Image from 'next/image';
import { IMAGES } from '@/utils/images';

export const dynamic = 'force-dynamic';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex">
      {/* ── Hero panel (desktop only) ── */}
      <div className="hidden lg:flex w-[52%] xl:w-[55%] flex-col bg-gradient-to-br from-[oklch(0.38_0.10_47)] via-[oklch(0.26_0.08_47)] to-[oklch(0.16_0.05_47)] relative overflow-hidden">

        {/* Decorative circles */}
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-40 -right-24 w-[28rem] h-[28rem] rounded-full bg-primary/8 blur-3xl pointer-events-none" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[42rem] h-[42rem] rounded-full border border-white/5 pointer-events-none" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[28rem] h-[28rem] rounded-full border border-white/5 pointer-events-none" />

        {/* Content */}
        <div className="relative flex flex-col h-full px-12 xl:px-16 py-12">
          {/* Centre brand */}
          <div className="flex-1 flex flex-col items-center justify-center gap-8 text-center">
            <Image
              src={IMAGES.logo}
              alt="Mountain Bakes logo"
              width={240}
              height={240}
              className="w-44 h-44 xl:w-56 xl:h-56 object-contain drop-shadow-2xl"
              priority
              unoptimized
            />
            <h1 className="font-serif text-5xl xl:text-6xl font-semibold text-primary tracking-wide leading-[1.1]">
              Mountain Bakes
            </h1>
            <h3 className="font-serif text-xl xl:text-2xl font-light text-white/80">
              Enterprise Resource Planning
            </h3>
          </div>

          {/* Footer */}
          <p className="text-xs text-white/25 text-center">
            &copy; {new Date().getFullYear()} Mountain Bakes. All rights reserved.
          </p>
        </div>
      </div>

      {/* ── Form panel ── */}
      <div className="flex flex-1 items-center justify-center bg-background px-4 py-10">
        {children}
      </div>
    </div>
  );
}
