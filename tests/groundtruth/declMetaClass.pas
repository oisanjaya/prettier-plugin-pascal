program MetaClassDemo;
{$mode objfpc}
{$H+}
type
  TAnimal = class
    public
      procedure Speak; virtual; abstract;
    end;
  TAnimalClass = class of TAnimal;
  TDog = class(TAnimal)
    public
      procedure Speak; override;
    end;
procedure TDog.Speak;
begin
  WriteLn('Woof!');
end;
procedure MakeAnimalSpeak(AClass: TAnimalClass);
var
  Animal: TAnimal;
begin
  Animal := AClass.Create;
  try
    Animal.Speak;
  finally
    Animal.Free;
  end;
end;
begin
  MakeAnimalSpeak(TDog);
end.
