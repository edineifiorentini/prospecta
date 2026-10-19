import { Brand } from "@/components/brand";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60rem_40rem_at_50%_-10%,oklch(0.92_0.06_155/0.55),transparent_70%)] dark:bg-[radial-gradient(60rem_40rem_at_50%_-10%,oklch(0.35_0.08_155/0.35),transparent_70%)]"
      />
      <div className="w-full max-w-[400px]">
        <div className="mb-8 flex justify-center">
          <Brand />
        </div>
        {children}
        <p className="mt-8 text-center text-xs text-muted-foreground">
          Execução local · Dados protegidos conforme a LGPD
        </p>
      </div>
    </main>
  );
}
