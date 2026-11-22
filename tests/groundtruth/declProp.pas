program DeclProp;
{$mode objfpc}
{$H+}
type
  TClass = class
    private
      function GetValue: Integer;
      procedure SetValue(AValue: Integer);
    public
      property Value: Integer read GetValue write SetValue;
    end;
function TClass.GetValue: Integer;
begin
  Result := 0;
end;
procedure TClass.SetValue(AValue: Integer);
begin
end;
begin
end.
