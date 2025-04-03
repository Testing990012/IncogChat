import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { 
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

interface CreateInstantFormProps {
  nickname: string;
  onSetNickname: (name: string) => void;
}

export default function CreateInstantForm({ nickname, onSetNickname }: CreateInstantFormProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [roomName, setRoomName] = useState("");
  const [enableHistory, setEnableHistory] = useState(true);
  const [enableNotifications, setEnableNotifications] = useState(true);

  const createRoomMutation = useMutation({
    mutationFn: async (formData: {
      nickname: string;
      roomName?: string;
      enableHistory: boolean;
      enableNotifications: boolean;
    }) => {
      const res = await apiRequest("POST", "/api/rooms/instant", formData);
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Chat Room Created",
        description: `Your chat room "${data.room.name}" has been created.`,
      });
      navigate(data.joinLink);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create chat room. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!nickname) {
      toast({
        title: "Nickname Required",
        description: "Please enter a nickname to create a chat room.",
        variant: "destructive",
      });
      return;
    }
    
    createRoomMutation.mutate({
      nickname,
      roomName: roomName || undefined,
      enableHistory,
      enableNotifications,
    });
  };

  return (
    <Card className="bg-white rounded-lg shadow-md p-6 mb-8">
      <CardHeader className="p-0 pb-4">
        <CardTitle className="font-secondary text-xl md:text-2xl font-bold">Create Instant Chat Room</CardTitle>
        <CardDescription className="text-secondary">
          Create a temporary chat room that will expire after 24 hours of inactivity.
        </CardDescription>
      </CardHeader>
      
      <CardContent className="p-0">
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <Label htmlFor="nickname" className="block text-sm font-medium text-secondary mb-1">
              Your Display Name
            </Label>
            <Input
              type="text"
              id="nickname"
              value={nickname}
              onChange={(e) => onSetNickname(e.target.value)}
              className="w-full px-3 py-2 border border-neutral-dark rounded-md"
              placeholder="Enter a nickname"
              required
            />
          </div>
          
          <div className="mb-4">
            <Label htmlFor="room-name" className="block text-sm font-medium text-secondary mb-1">
              Room Name (Optional)
            </Label>
            <Input
              type="text"
              id="room-name"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              className="w-full px-3 py-2 border border-neutral-dark rounded-md"
              placeholder="Give your room a name"
            />
          </div>
          
          <div className="mb-5">
            <Label className="block text-sm font-medium text-secondary mb-1">
              Chat Room Settings
            </Label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="enable-history" 
                  checked={enableHistory}
                  onCheckedChange={(checked) => setEnableHistory(checked as boolean)}
                />
                <label htmlFor="enable-history" className="text-sm text-secondary">
                  Message History
                </label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="enable-notifications" 
                  checked={enableNotifications}
                  onCheckedChange={(checked) => setEnableNotifications(checked as boolean)}
                />
                <label htmlFor="enable-notifications" className="text-sm text-secondary">
                  Enable Notifications
                </label>
              </div>
            </div>
          </div>
          
          <Button 
            type="submit" 
            className="w-full bg-accent hover:bg-accent-dark text-white"
            disabled={createRoomMutation.isPending}
          >
            {createRoomMutation.isPending ? "Creating..." : "Create Chat Room"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
