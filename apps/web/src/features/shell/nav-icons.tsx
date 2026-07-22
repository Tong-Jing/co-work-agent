function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      {children}
    </svg>
  );
}

export function PlusIcon() {
  return (
    <Svg>
      <path d="M10 4v12M4 10h12" strokeLinecap="round" />
    </Svg>
  );
}

export function McpIcon() {
  return (
    <Svg>
      <rect x="3" y="4" width="14" height="8" rx="2" />
      <path d="M6.5 16h7M10 12v4" strokeLinecap="round" />
    </Svg>
  );
}

export function SkillsIcon() {
  return (
    <Svg>
      <path d="M10 3l2.2 4.5 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.5 5-.7z" strokeLinejoin="round" />
    </Svg>
  );
}

export function MemoryIcon() {
  return (
    <Svg>
      <path d="M10 3a4 4 0 00-4 4v1.2A3.5 3.5 0 004 11.5 3.5 3.5 0 007.5 15H8" strokeLinecap="round" />
      <path d="M10 3a4 4 0 014 4v1.2a3.5 3.5 0 012 3.3A3.5 3.5 0 0112.5 15H12" strokeLinecap="round" />
      <path d="M10 3v14" strokeLinecap="round" />
    </Svg>
  );
}

export function WorkflowIcon() {
  return (
    <Svg>
      <rect x="3" y="4" width="5" height="5" rx="1" />
      <rect x="12" y="4" width="5" height="5" rx="1" />
      <rect x="7.5" y="12" width="5" height="5" rx="1" />
      <path d="M5.5 9v1.5a2 2 0 002 2H7M14.5 9v1.5a2 2 0 01-2 2H12" strokeLinecap="round" />
    </Svg>
  );
}

export function PermissionsIcon() {
  return (
    <Svg>
      <path d="M10 3l6 2.2v4.3c0 3.8-2.5 6.6-6 7.5-3.5-.9-6-3.7-6-7.5V5.2L10 3z" strokeLinejoin="round" />
      <path d="M7.5 10l1.8 1.8L12.8 8" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
