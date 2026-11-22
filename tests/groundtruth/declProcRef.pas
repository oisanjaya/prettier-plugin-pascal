program DeclProcRef;
{$modeswitch functionreferences}
type
  TProc = reference to procedure(A: Integer);
begin
end.
