program DeclPropArgs;
{$mode objfpc}
{$H+}
type
  TClass = class
    private
      function GetItem(Index: Integer): Integer;
    public
      property Item[Index: Integer]: Integer read GetItem;
    end;
function TClass.GetItem(Index: Integer): Integer;
begin
  Result := Index;
end;
begin
end.
