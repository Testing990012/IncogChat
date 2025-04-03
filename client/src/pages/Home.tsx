import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import Sidebar from "@/components/Sidebar";
import CreateInstantForm from "@/components/CreateInstantForm";
import ScheduleChatForm from "@/components/ScheduleChatForm";
import JoinChatForm from "@/components/JoinChatForm";
import ActiveRoomCard from "@/components/ActiveRoomCard";
import { useQuery } from "@tanstack/react-query";
import { Room } from "@shared/schema";

type TabType = "instant" | "schedule" | "join";

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabType>("instant");
  const [nickname, setNickname] = useState<string>(() => {
    return localStorage.getItem("chatvault-nickname") || "";
  });
  const { toast } = useToast();

  // Get active rooms if there is a nickname
  const { data: activeRooms, isLoading: roomsLoading } = useQuery<{ rooms: Room[] }>({
    queryKey: ["/api/rooms/active", nickname],
    enabled: !!nickname,
  });

  const handleSetNickname = (name: string) => {
    setNickname(name);
    localStorage.setItem("chatvault-nickname", name);
  };

  const getActiveComponent = () => {
    switch (activeTab) {
      case "instant":
        return <CreateInstantForm nickname={nickname} onSetNickname={handleSetNickname} />;
      case "schedule":
        return <ScheduleChatForm nickname={nickname} onSetNickname={handleSetNickname} />;
      case "join":
        return <JoinChatForm nickname={nickname} onSetNickname={handleSetNickname} />;
      default:
        return <CreateInstantForm nickname={nickname} onSetNickname={handleSetNickname} />;
    }
  };

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-background font-primary">
      <Sidebar activeItem="chat-rooms" />
      
      <main className="flex-grow p-4 md:p-8 bg-gradient-to-b from-background to-muted/30">
        <div className="max-w-5xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-primary mb-2">ChatVault</h1>
            <p className="text-muted-foreground">Secure, temporary chat rooms for when privacy matters.</p>
          </div>
        
          {/* Tabs */}
          <div className="border-b border-muted mb-6">
            <div className="flex space-x-1 md:space-x-8">
              <button 
                className={`px-4 py-3 text-sm md:text-base font-medium transition-all relative ${
                  activeTab === "instant" 
                    ? "text-primary" 
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setActiveTab("instant")}
              >
                Create Instant Chat
                {activeTab === "instant" && (
                  <span className="absolute bottom-0 left-0 w-full h-0.5 bg-primary rounded-t-sm"></span>
                )}
              </button>
              <button 
                className={`px-4 py-3 text-sm md:text-base font-medium transition-all relative ${
                  activeTab === "schedule" 
                    ? "text-primary" 
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setActiveTab("schedule")}
              >
                Schedule Chat
                {activeTab === "schedule" && (
                  <span className="absolute bottom-0 left-0 w-full h-0.5 bg-primary rounded-t-sm"></span>
                )}
              </button>
              <button 
                className={`px-4 py-3 text-sm md:text-base font-medium transition-all relative ${
                  activeTab === "join" 
                    ? "text-primary" 
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setActiveTab("join")}
              >
                Join Chat
                {activeTab === "join" && (
                  <span className="absolute bottom-0 left-0 w-full h-0.5 bg-primary rounded-t-sm"></span>
                )}
              </button>
            </div>
          </div>
          
          {/* Card wrapper */}
          <div className="bg-card rounded-lg shadow-md p-6 border border-border">
            {/* Active Form */}
            {getActiveComponent()}
          </div>
          
          {/* Active Rooms */}
          {nickname && (activeRooms?.rooms?.length || 0) > 0 && (
            <div className="mt-8">
              <ActiveRoomCard rooms={activeRooms?.rooms || []} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
