program TyperefDotTest;
{$mode objfpc}
{$H+}
type
  TContainer = class
    public
      type
        TStatus = (stReady, stBusy, stError);
    end;
var
  CurrentStatus: TContainer.TStatus;
begin
end.
