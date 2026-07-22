export default function Home() {
  return (
    <main className="min-h-screen p-12 bg-black text-zinc-100">
      <section className="max-w-2xl bg-zinc-900 text-white rounded-sm space-y-6">
        <h1 className="bg-transparent text-4xl font-bold">Design Engineer   </h1>
        <p className="bg-transparent text-white">
          Click any element on the canvas to inspect its source location.
        </p>
        <button className="block flex-col items-center px-6 py-3 bg-[#749ffb] text-black rounded-lg">
          Get Started
        </button>
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 bg-zinc-900 rounded-md border border-zinc-800">
            First ever tool
          </div>
          <div className="p-4 bg-zinc-900 rounded-md border border-zinc-800">
            Second tool 
          </div>
        </div>
      </section>
    </main>
  );
}
