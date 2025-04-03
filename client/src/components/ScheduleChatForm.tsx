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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ScheduleChatFormProps {
  nickname: string;
  onSetNickname: (name: string) => void;
}

export default function ScheduleChatForm({ nickname, onSetNickname }: ScheduleChatFormProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [roomName, setRoomName] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [duration, setDuration] = useState("60");

  const scheduleRoomMutation = useMutation({
    mutationFn: async (formData: {
      nickname: string;
      roomName: string;
      scheduledDate: string;
      duration: number;
    }) => {
      const res = await apiRequest("POST", "/api/rooms/scheduled", formData);
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Chat Room Scheduled",
        description: `Your chat room "${data.room.name}" has been scheduled.`,
      });
      navigate("/");
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to schedule chat room. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!nickname) {
      toast({
        title: "Nickname Required",
        description: "Please enter a nickname to schedule a chat room.",
        variant: "destructive",
      });
      return;
    }
    
    if (!roomName) {
      toast({
        title: "Room Name Required",
        description: "Please give your scheduled room a name.",
        variant: "destructive",
      });
      return;
    }
    
    if (!scheduledDate || !scheduledTime) {
      toast({
        title: "Schedule Required",
        description: "Please select a date and time for your chat room.",
        variant: "destructive",
      });
      return;
    }
    
    // Combine date and time
    const scheduledDateTime = new Date(`${scheduledDate}T${scheduledTime}`);
    
    if (scheduledDateTime < new Date()) {
      toast({
        title: "Invalid Schedule",
        description: "The scheduled time must be in the future.",
        variant: "destructive",
      });
      return;
    }
    
    scheduleRoomMutation.mutate({
      nickname,
      roomName,
      scheduledDate: scheduledDateTime.toISOString(),
      duration: parseInt(duration),
    });
  };

  return (
    <Card className="bg-white rounded-lg shadow-md p-6 mb-8">
      <CardHeader className="p-0 pb-4">
        <CardTitle className="font-secondary text-xl md:text-2xl font-bold">Schedule Chat Room</CardTitle>
        <CardDescription className="text-secondary">
          Schedule a chat room for a future time. Participants can join using the room code.
        </CardDescription>
      </CardHeader>
      
      <CardContent className="p-0">
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <Label htmlFor="schedule-nickname" className="block text-sm font-medium text-secondary mb-1">
              Your Display Name
            </Label>
            <Input
              type="text"
              id="schedule-nickname"
              value={nickname}
              onChange={(e) => onSetNickname(e.target.value)}
              className="w-full px-3 py-2 border border-neutral-dark rounded-md"
              placeholder="Enter a nickname"
              required
            />
          </div>
          
          <div className="mb-4">
            <Label htmlFor="schedule-room-name" className="block text-sm font-medium text-secondary mb-1">
              Room Name
            </Label>
            <Input
              type="text"
              id="schedule-room-name"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              className="w-full px-3 py-2 border border-neutral-dark rounded-md"
              placeholder="Give your room a name"
              required
            />
          </div>
          
          <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="schedule-date" className="block text-sm font-medium text-secondary mb-1">
                Date
              </Label>
              <Input
                type="date"
                id="schedule-date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                className="w-full px-3 py-2 border border-neutral-dark rounded-md"
                required
              />
            </div>
            <div>
              <Label htmlFor="schedule-time" className="block text-sm font-medium text-secondary mb-1">
                Time
              </Label>
              <Input
                type="time"
                id="schedule-time"
                value={scheduledTime}
                onChange={(e) => setScheduledTime(e.target.value)}
                className="w-full px-3 py-2 border border-neutral-dark rounded-md"
                required
              />
            </div>
          </div>
          
          <div className="mb-5">
            <Label htmlFor="schedule-duration" className="block text-sm font-medium text-secondary mb-1">
              Duration
            </Label>
            <Select
              value={duration}
              onValueChange={setDuration}
            >
              <SelectTrigger className="w-full px-3 py-2 border border-neutral-dark rounded-md">
                <SelectValue placeholder="Select duration" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30 minutes</SelectItem>
                <SelectItem value="60">1 hour</SelectItem>
                <SelectItem value="120">2 hours</SelectItem>
                <SelectItem value="240">4 hours</SelectItem>
                <SelectItem value="480">8 hours</SelectItem>
                <SelectItem value="1440">24 hours</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <Button 
            type="submit" 
            className="w-full bg-accent hover:bg-accent-dark text-white"
            disabled={scheduleRoomMutation.isPending}
          >
            {scheduleRoomMutation.isPending ? "Scheduling..." : "Schedule Chat"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
