import { Link } from "wouter";
import { 
  MessageSquare, 
  Info, 
  Settings
} from "lucide-react";

interface SidebarProps {
  activeItem?: "chat-rooms" | "about" | "settings";
}

export default function Sidebar({ activeItem = "chat-rooms" }: SidebarProps) {
  return (
    <aside className="bg-primary text-white w-full md:w-64 md:min-h-screen flex-shrink-0 shadow-lg flex flex-col">
      <div className="p-6 border-b border-primary-dark/20">
        <h1 className="font-bold text-2xl tracking-wide">ChatVault</h1>
        <p className="text-sm opacity-80 mt-1">Ephemeral Conversations</p>
      </div>
      
      <nav className="p-4 flex-grow">
        <h2 className="text-xs uppercase tracking-wider opacity-70 mb-3 ml-2">Menu</h2>
        <ul className="space-y-1">
          <li>
            <Link href="/" className={`flex items-center p-3 rounded-md transition-all duration-200 ${
              activeItem === "chat-rooms" 
                ? "bg-white/20 text-white font-medium" 
                : "hover:bg-white/10 text-white/80 hover:text-white"
            }`}>
              <MessageSquare className="h-5 w-5 mr-3" />
              Chat Rooms
            </Link>
          </li>
          <li>
            <Link href="/about" className={`flex items-center p-3 rounded-md transition-all duration-200 ${
              activeItem === "about" 
                ? "bg-white/20 text-white font-medium" 
                : "hover:bg-white/10 text-white/80 hover:text-white"
            }`}>
              <Info className="h-5 w-5 mr-3" />
              About
            </Link>
          </li>
          <li>
            <Link href="/settings" className={`flex items-center p-3 rounded-md transition-all duration-200 ${
              activeItem === "settings" 
                ? "bg-white/20 text-white font-medium" 
                : "hover:bg-white/10 text-white/80 hover:text-white"
            }`}>
              <Settings className="h-5 w-5 mr-3" />
              Settings
            </Link>
          </li>
        </ul>
      </nav>
      
      <div className="p-4 border-t border-primary-dark/20">
        <div className="flex items-center text-sm bg-white/10 p-3 rounded-md">
          <div className="w-2 h-2 rounded-full bg-emerald-400 mr-2"></div>
          <span>Connected</span>
        </div>
      </div>
    </aside>
  );
}
