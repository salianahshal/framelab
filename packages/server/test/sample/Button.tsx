import React from 'react';

type ButtonProps = {
  label: string;
  onClick?: () => void;
};

export default function Button({ label, onClick }: ButtonProps) {
  return (
    <div className="p-4 bg-zinc-900 rounded-md">
      <h2 className="text-lg font-semibold">Sign up today</h2>
      <p className="text-zinc-400">Click below to begin.</p>
      <button
        className="px-6 py-3 bg-blue-600 text-white rounded-lg"
        onClick={onClick}
      >
        {label}
      </button>
    </div>
  );
}
