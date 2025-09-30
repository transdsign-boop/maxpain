export default function AsterLogo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <svg 
        width="40" 
        height="40" 
        viewBox="0 0 40 40" 
        fill="none" 
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Outer circle - representing DEX ecosystem */}
        <circle 
          cx="20" 
          cy="20" 
          r="18" 
          stroke="currentColor" 
          strokeWidth="2" 
          className="text-primary"
          opacity="0.3"
        />
        
        {/* Star/Aster shape - 8 points */}
        <path
          d="M20 4 L22 14 L28 8 L24 16 L34 16 L26 20 L34 24 L24 24 L28 32 L22 26 L20 36 L18 26 L12 32 L16 24 L6 24 L14 20 L6 16 L16 16 L12 8 L18 14 Z"
          fill="currentColor"
          className="text-primary"
        />
        
        {/* Center dot - representing focus/target */}
        <circle 
          cx="20" 
          cy="20" 
          r="3" 
          fill="currentColor"
          className="text-primary-foreground"
        />
      </svg>
      
      <div className="flex flex-col leading-tight">
        <span className="text-xl font-bold tracking-tight">ASTER</span>
        <span className="text-xs text-muted-foreground tracking-wider">DEX TRADING</span>
      </div>
    </div>
  );
}
