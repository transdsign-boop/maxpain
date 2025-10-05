export default function AsterLogo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <svg 
        width="36" 
        height="36" 
        viewBox="0 0 36 36" 
        fill="none" 
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Hexagon/Cube shape - sleek and minimal */}
        <path
          d="M18 2 L32 10 L32 26 L18 34 L4 26 L4 10 Z"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinejoin="miter"
          className="text-primary"
          fill="none"
        />
        
        {/* Inner lines for depth */}
        <path
          d="M18 2 L18 18 M18 18 L4 10 M18 18 L32 10"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinejoin="miter"
          className="text-primary"
          opacity="0.6"
        />
      </svg>
      
      <div className="flex flex-col leading-tight">
        <span className="text-xl font-bold tracking-tight">MPI<sup className="text-[8px] ml-0.5">™</sup></span>
        <span className="text-xs text-muted-foreground tracking-wider">LIQUIDATION HUNTER BOT</span>
      </div>
    </div>
  );
}
